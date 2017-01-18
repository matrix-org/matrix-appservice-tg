"use strict";

var Promise = require("bluebird");

var TelegramGhost = require("./TelegramGhost");

function Portal(main, opts) {
    this._main = main;

    this._matrix_user_id = opts.matrix_user_id || opts.matrix_user.userId();
    this._matrix_user    = opts.matrix_user;
    this._peer           = opts.peer;
}

Portal.fromEntry = function(main, entry) {
    if (entry.type !== "portal") {
        throw new Error("Can only make Portal out of entry.type == 'portal'");
    }

    return new Portal(main, {
        matrix_user_id: entry.data.matrix_user_id,
        peer:           TelegramGhost.Peer.fromSubentry(entry.data.peer),
    });
}

Portal.prototype.toEntry = function() {
    var key = this.getKey();

    return {
        type: "portal",
        id: key,
        data: {
            matrix_user_id: this._matrix_user_id,
            matrix_room_id: this._matrix_room_id,
            peer:           this._peer.toSubentry(),
        },
    };
};

Portal.prototype.getKey = function() {
    return [this._matrix_user_id, this._peer.getKey()].join(" ");
};

Portal.prototype.getMatrixRoomId = function() {
    return this._matrix_room_id;
};

Portal.prototype.getMatrixUser = function() {
    if (this._matrix_user) return Promise.resolve(this._matrix_user);
    return this._main.getOrCreateMatrixUser(this._matrix_user_id).then((user) => {
        this._matrix_user = user;
        return user;
    });
};

Portal.prototype.provisionMatrixRoom = function() {
    // Create the room.
    // [TODO: set attributes on it like title and avatar image]
    // Invite the MatrixUser to it

    if (this._matrix_room_id) return Promise.done();

    var bot = this._main.getBotIntent();

    return bot.createRoom({
        options: {
            // Don't give it an alias
            name: `[Telegram ${this._peer._type} ${this._peer._id}]`,
            visibility: "private",
        }
    }).then((result) => {
        this._matrix_room_id = result.room_id;
        this._main._portalsByMatrixId[this._matrix_room_id] = this;

        return this._main.putRoom(this);
    }).then(() => {
        // TODO: set avatar image

        return bot.invite(this._matrix_room_id, this._matrix_user_id);
    });
};

Portal.prototype.onMatrixEvent = function(ev) {
    switch(ev.type) {
        case "m.room.message":
            return this.getMatrixUser().then((user) => {
                return user.getTelegramGhost();
            }).then((ghost) => {
                // TODO: this only copes with msgtype=="m.text"
                return ghost.sendMessage(this._peer, ev.content.body);
            });
            break;

        default:
            console.log("Incoming event", ev, "to", this);
            break;
    }
};

module.exports = Portal;
