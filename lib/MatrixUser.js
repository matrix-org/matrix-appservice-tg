"use strict";

var TelegramGhost = require("./TelegramGhost");

/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user
 */

function MatrixUser(main, opts) {
    this._main = main;

    this._user_id = opts.user_id;

    this._atime = null; // last activity time in epoch seconds

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

    return u;
};

MatrixUser.prototype.toEntry = function() {
    return {
        type: "matrix",
        id: this._user_id,
        data: {
            phone_number: this._phoneNumber,
            phone_code_hash: this._phoneCodeHash,
        },
    };
};

MatrixUser.prototype.userId = function() {
    return this._user_id;
};

MatrixUser.prototype.setPhoneNumber = function(phone_number) {
    this._phoneNumber = phone_number;
};

MatrixUser.prototype.setPhoneCodeHash = function(phone_code_hash) {
    this._phoneCodeHash = phone_code_hash;
};

MatrixUser.prototype.getTelegramGhost = function() {
    // TODO(paul): maybe this ought to indirect via main?
    return this._ghost = this._ghost ||
        new TelegramGhost({
            main: this._main,
        });
};

MatrixUser.prototype.getATime = function() {
    return this._atime;
};

MatrixUser.prototype.bumpATime = function() {
    this._atime = Date.now() / 1000;
};

module.exports = MatrixUser;
