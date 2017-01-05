"use strict";

/*
 * Represents a user we have seen from Matrix; i.e. a real Matrix user
 */

function MatrixUser(main, opts) {
    this._main = main;

    this._user_id = opts.user_id;

    this._atime = null; // last activity time in epoch seconds
}

MatrixUser.fromEntry = function(main, entry) {
    if (entry.type !== "matrix") {
        throw new Error("Can only make MatrixUser out of entry.type == 'matrix'");
    }

    var u = new MatrixUser(main, {
        user_id: entry.id,
    });

    return u;
};

MatrixUser.prototype.toEntry = function() {
    return {
        type: "matrix",
        id: this._user_id,
        data: {
        },
    };
};

MatrixUser.prototype.userId = function() {
    return this._user_id;
};

MatrixUser.prototype.getATime = function() {
    return this._atime;
};

MatrixUser.prototype.bumpATime = function() {
    this._atime = Date.now() / 1000;
};

module.exports = MatrixUser;
