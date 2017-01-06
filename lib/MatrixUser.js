"use strict";

var TelegramGhost = require("./TelegramGhost");

/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user
 */

function MatrixUser(main, opts) {
    this._main = main;

    this._user_id = opts.user_id;

    this._atime = null; // last activity time in epoch seconds

    this._dataCenter = null;
    // the *encrypted* auth key
    this._authKeyBuffer = null;

    this._phoneNumber = null;
    this._phoneCodeHash = null;
}

MatrixUser.fromEntry = function(main, entry) {
    if (entry.type !== "matrix") {
        throw new Error("Can only make MatrixUser out of entry.type == 'matrix'");
    }

    var u = new MatrixUser(main, {
        user_id: entry.id,
    });

    u._phoneNumber = entry.data.phone_number;
    u._phoneCodeHash = entry.data.phone_code_hash;

    u._dataCenter = entry.data.data_center;

    if (entry.data.auth_key) {
        u._authKeyBuffer = new Buffer(entry.data.auth_key, 'base64');
    }

    return u;
};

MatrixUser.prototype.toEntry = function() {
    if (!this._authKeyBuffer && this._ghost) {
        // gutwrench 'config'
        this._authKeyBuffer = this._ghost.getAuthKey(this._main._config.auth_key_password);
    }
    if (this._ghost) {
        this._dataCenter = this._ghost.getDataCenter();
    }
    var auth_key_buffer = this._authKeyBuffer;

    return {
        type: "matrix",
        id: this._user_id,
        data: {
            phone_number: this._phoneNumber,
            phone_code_hash: this._phoneCodeHash,
            data_center: this._dataCenter,
            auth_key: auth_key_buffer ? auth_key_buffer.toString('base64') : null,
        },
    };
};

MatrixUser.prototype.userId = function() {
    return this._user_id;
};

MatrixUser.prototype.getTelegramGhost = function() {
    // TODO(paul): maybe this ought to indirect via main?
    return this._ghost = this._ghost ||
        new TelegramGhost({
            main: this._main,

            data_center: this._dataCenter,
            auth_key_buffer: this._authKeyBuffer,
            auth_key_password: this._main._config.auth_key_password,
        });
};

// Helper function for catching Telegram errors
function _unrollError(err) {
    var message = err.toPrintable ? err.toPrintable() : err.toString();

    console.log("Failed:", message);
    throw new Error(message);
}

MatrixUser.prototype.sendCodeToTelegram = function(phone_number) {
    if (this._phoneNumber && phone_number !== this._phoneNumber) {
        throw new Error("TODO: Already have a phone number");
    }

    return this.getTelegramGhost().sendCode(phone_number).then(
        (result) => {
            this._phoneNumber = phone_number;
            this._phoneCodeHash = result.phone_code_hash;

            return this._main.putUser(this);
        },
        (err) => _unrollError(err)
    );
};

MatrixUser.prototype.signInToTelegram = function(phone_code) {
    var ghost = this.getTelegramGhost();

    if (!this._phoneNumber) throw new Error("User does not have an associated phone number");
    if (!this._phoneCodeHash) throw new Error("User does not have a pending phone code authentication");

    return this.getTelegramGhost().signIn(
        this._phoneNumber, this._phoneCodeHash, phone_code
    ).then(
        (result) => {
            console.log("Signed in; result:", result);

            // TODO: capture auth key somehow from ghost client
            this._phoneCodeHash = null;

            // By now, the user will have an auth key
            return this._main.putUser(this);
        },
        (err) => _unrollError(err)
    );
};

MatrixUser.prototype.getATime = function() {
    return this._atime;
};

MatrixUser.prototype.bumpATime = function() {
    this._atime = Date.now() / 1000;
};

module.exports = MatrixUser;
