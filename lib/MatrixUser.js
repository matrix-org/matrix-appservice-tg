/*
Copyright 2017 Vector Creations Ltd
Copyright 2017, 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

"use strict";

var TelegramGhost = require("./TelegramGhost");

/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user
 */

function MatrixUser(main, opts) {
    this._main = main;

    this._user_id = opts.user_id;

    this._atime = null; // last activity time in epoch seconds

    // the *encrypted* auth key
    this._authKeyBuffer = null;

    this._phoneNumber = null;
    this._phoneCodeHash = null;

    this._ghost_data = {};
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

    if (entry.data.ghost) {
        u._ghost_data = entry.data.ghost;
        // Create the ghost so it starts the actual telegram client
        u.getTelegramGhost();
    }

    return u;
};

MatrixUser.prototype.toEntry = function() {
    if (this._ghost) {
        this._ghost_data = this._ghost.toSubentry();
    }

    return {
        type: "matrix",
        id: this._user_id,
        data: {
            phone_number: this._phoneNumber,
            phone_code_hash: this._phoneCodeHash,
            ghost: this._ghost_data,
        },
    };
};

// for TelegramGhost to call, for updating the database from its sub-entry
MatrixUser.prototype._updated = function() {
    return this._main.putUser(this);
};

MatrixUser.prototype.userId = function() {
    return this._user_id;
};

MatrixUser.prototype.getTelegramGhost = function() {
    // TODO(paul): maybe this ought to indirect via main?
    return this._ghost = this._ghost ||
        TelegramGhost.fromSubentry(this, this._main, this._ghost_data);
};

// Helper function for catching Telegram errors
function _unrollError(err) {
    var message = err.toPrintable ? err.toPrintable() : err.toString();

    console.log("Failed:", message);
    if (err instanceof Error) {
        throw err;
    }
    else {
        throw new Error(message);
    }
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
            return this._main.putUser(this)
                .then(() => result);
        },
        (err) => _unrollError(err)
    );
};

MatrixUser.prototype.checkPassword = function(password_hash) {
    return this.getTelegramGhost().checkPassword(password_hash).then(() => {
        // By now, the user will have a proper user ID field
        return this._main.putUser(this);
    });
};

MatrixUser.prototype.getATime = function() {
    return this._atime;
};

MatrixUser.prototype.bumpATime = function() {
    this._atime = Date.now() / 1000;
};

module.exports = MatrixUser;
