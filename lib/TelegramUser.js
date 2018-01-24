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

/*
 * Represents a user we have seen from Telegram; i.e. a real Telegram user who
 * likely has a Matrix-side ghost
 */

function TelegramUser(main, opts) {
    this._main = main;
    this._id = opts.id;

    if (opts.user) {
        this.updateFrom(opts.user);
    }
}

TelegramUser.fromEntry = function(main, entry) {
    if(entry.type !== "remote") {
        throw new Error("Can only make TelegramUser out of entry.type == 'remote'");
    }

    var u = new TelegramUser(main, {
        id: entry.id,
    });

    var data = entry.data;
    u._first_name = data.first_name;
    u._last_name  = data.last_name;
    u._photo      = data.photo;
    u._avatar_url = data.avatar_url;

    return u;
};

TelegramUser.prototype.toEntry = function() {
    return {
        type: "remote",
        id: this._id,
        data: {
            first_name: this._first_name,
            last_name:  this._last_name,
            photo:      this._photo,
            avatar_url: this._avatar_url,
        },
    };
};

TelegramUser.prototype.updateFrom = function(user) {
    var changed = false;

    if (this._first_name != user.first_name) changed = true;
    this._first_name = user.first_name;

    if (this._last_name != user.last_name) changed = true;
    this._last_name  = user.last_name;

    return changed;
};

TelegramUser.prototype.updateAvatarImageFrom = function(user, ghost) {
    if (!user.photo) return Promise.resolve();

    var photo = user.photo.photo_big;
    if (this._photo && this._avatar_url &&
            this._photo.dc_id == photo.dc_id &&
            this._photo.volume_id == photo.volume_id &&
            this._photo.local_id == photo.local_id) {
        return Promise.resolve(this._avatar_url);
    }

    return ghost.getFile(photo).then((file) => {
        var name = `${photo.volume_id}_${photo.local_id}.${file.extension}`;

        return this.uploadContent({
            stream: new Buffer(file.bytes),
            name:   name,
            type:   file.mimetype,
        });
    }).then((response) => {
        var content_uri = response.content_uri;

        this._avatar_url = content_uri;
        this._photo = {
            dc_id:     photo.dc_id,
            volume_id: photo.volume_id,
            local_id:  photo.local_id,
        };

        return this._main.putUser(this).then(
            () => content_uri
        );
    });
};

TelegramUser.prototype.getDisplayname = function() {
    return [this._first_name, this._last_name].filter((s) => !!s)
        .join(" ");
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
