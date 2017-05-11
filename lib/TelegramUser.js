"use strict";

/*
 * Represents a user we have seen from Telegram; i.e. a real Telegram user who
 * likely has a Matrix-side ghost
 */

function TelegramUser(main, opts) {
    this._main = main;
    this._id = opts.id;
}

TelegramUser.fromEntry = function(main, entry) {
    if(entry.type !== "remote") {
        throw new Error("Can only make TelegramUser out of entry.type == 'remote'");
    }

    var u = new TelegramUser(main, {
        id: entry.id,
    });

    return u;
};

TelegramUser.prototype.toEntry = function() {
    return {
        type: "remote",
        id: this._id,
        data: {},
    };
};

TelegramUser.prototype._getIntent = function() {
    if (this._intent) return this._intent;

    var intent = this._main.getIntentForTelegramId(this._id);
    return this._intent = intent;
};

TelegramUser.prototype.getMxid = function() {
    return this._getIntent().client.credentials.userId;
};

TelegramUser.prototype.sendText = function(matrix_room_id, text) {
    return this._getIntent().sendText(matrix_room_id, text);
};

TelegramUser.prototype.sendImage = function(matrix_room_id, opts) {
    return this._getIntent().sendMessage(matrix_room_id, {
        msgtype: "m.image",
        url: opts.content_uri,
        body: opts.name,
        info: opts.info,
    });
};

TelegramUser.prototype.sendSelfStateEvent = function(matrix_room_id, type, content) {
    return this._getIntent().sendStateEvent(matrix_room_id, type, this.getMxid(), content);
};

TelegramUser.prototype.uploadContent = function(opts) {
    return this._getIntent().getClient().uploadContent({
        stream: opts.stream,
        name:   opts.name,
        type:   opts.type,
    }, {
        rawResponse: false,
    });
};

module.exports = TelegramUser;
