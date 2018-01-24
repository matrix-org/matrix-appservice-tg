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

var Promise = require("bluebird");

var rp = require("request-promise");

var TelegramGhost = require("./TelegramGhost");
var META_FROM_MIMETYPE = TelegramGhost.META_FROM_MIMETYPE;

function Portal(main, opts) {
    this._main = main;

    this._matrix_room_id = opts.matrix_room_id;
    this._matrix_user_id = opts.matrix_user_id || opts.matrix_user.userId();
    this._matrix_user    = opts.matrix_user;
    this._peer           = opts.peer;
}

Portal.fromEntry = function(main, entry) {
    if (entry.type !== "portal") {
        throw new Error("Can only make Portal out of entry.type == 'portal'");
    }

    return new Portal(main, {
        matrix_room_id: entry.data.matrix_room_id,
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

Portal.prototype.getTelegramGhost = function() {
    return this.getMatrixUser().then((user) => user.getTelegramGhost());
};

Portal.prototype.provisionMatrixRoom = function() {
    // Create the room.
    // Invite the MatrixUser to it

    if (this._matrix_room_id) return Promise.resolve();

    var bot = this._main.getBotIntent();

    var chat_info;
    return this.getTelegramGhost().then((ghost) => {
        return ghost.getChatInfo(this._peer);
    }).then((_info) => {
        chat_info = _info;

        return bot.createRoom({
            options: {
                // Don't give it an alias
                name: chat_info.title,
                visibility: "private",
            }
        });
    }).then((result) => {
        this._matrix_room_id = result.room_id;
        this._main._portalsByMatrixId[this._matrix_room_id] = this;

        // TODO: set room avatar image

        return this._main.putRoom(this);
    }).then(() => {
        return this._fixParticipants(chat_info.participants, true);
    }).then(() => {
        return bot.invite(this._matrix_room_id, this._matrix_user_id);
    });
};

Portal.prototype.fixMatrixRoom = function() {
    var bot = this._main.getBotIntent();
    var room_id = this._matrix_room_id;

    return this.getTelegramGhost().then((ghost) => {
        return ghost.getChatInfo(this._peer);
    }).then((info) => {
        return Promise.all([
            bot.setRoomName(room_id, info.title),
            this._fixParticipants(info.participants),
        ])
    });
};

function _maybe_invite(bot_intent, room_id, user_id, callback) {
    return callback().then(
        (result) => result,
        (err) => {
            if (!err.errcode ||
                err.errcode !== "M_FORBIDDEN") throw err;

            // Invite then retry one more time
            return bot_intent.invite(room_id, user_id).then(() => {
                return callback();
            });
        }
    );
}

Portal.prototype._fixParticipants = function(participants, invite_first) {
    var main = this._main;
    var room_id = this._matrix_room_id;

    var bot_intent = main.getBotIntent();

    return Promise.all(
        participants.map((p) => {
            return main.getTelegramUserFor({
                user: p,
                create: true,
            }).then((user) => {
                return this.getTelegramGhost().then((ghost) => {
                    return user.updateAvatarImageFrom(p, ghost);
                }).then((avatar_url) => {
                    return _maybe_invite(bot_intent, room_id, user.getMxid(), () => {
                        var content = {
                            membership: "join",
                            displayname: user.getDisplayname(),
                        };
                        if (avatar_url) {
                            content.avatar_url = avatar_url;
                        }

                        return user.sendSelfStateEvent(room_id, "m.room.member", content);
                    });
                });
            });
        })
    );
};

Portal.prototype.onMatrixEvent = function(ev) {
    switch(ev.type) {
        case "m.room.message":
            var content = ev.content;

            return this.getTelegramGhost().then((ghost) => {
                switch (content.msgtype) {
                    case "m.text":
                        return ghost.sendMessage(this._peer, ev.content.body);

                    case "m.image":
                        return this._handleMatrixImage(ghost, content);
                }

                console.log(`TODO: incoming message type ${content.msgtype}`);
            });

        default:
            console.log("Incoming event", ev, "to", this);
            break;
    }

    return Promise.resolve();
};

Portal.prototype._handleMatrixImage = function(ghost, content) {
    return rp({
        method: "GET",
        uri: this._main.getUrlForMxc(content.url),
        resolveWithFullResponse: true,
        encoding: null,
    }).then((response) => {
        var extension = META_FROM_MIMETYPE[response.headers['content-type']].extension;

        return ghost.uploadFile(response.body, "photo." + extension).then((file) => {
            var inputMedia = {
                _: "inputMediaUploadedPhoto",
                file: file,
                caption: "",
            };

            return ghost.sendMedia(this._peer, inputMedia);
        });
    });
};

Portal.prototype.onTelegramUpdate = function(update, hints) {
    var user;

    var from_id = hints.from_id;

    switch(update._) {
        case "updateNewMessage":
        case "updateNewChannelMessage":
            update = update.message;
            /* fallthrough */
        case "updateShortChatMessage":
            from_id = from_id || update.from_id;

            console.log(` | user ${from_id} sent message`);
            return this._main.getTelegramUserFor({user_id: from_id}).then((user) => {
                return this._onTelegramMessageFrom(update, user);
            });

        case "updateChatUserTyping":
            console.log(` | user ${update.user_id} is typing`);
            // ignore for now
            return Promise.resolve();

        case "updateReadChannelInbox":
            // another session read up to here
            return Promise.resolve();

        default:
            console.log(`Unrecognised UPDATE ${update._}:`, update);
            break;
    }

    return Promise.resolve();
};

Portal.prototype._onTelegramMessageFrom = function(update, user) {
    var media = update.media;

    switch(media ? media._ : null) {
        case null:
            return user.sendText(this._matrix_room_id, update.message);

        case "messageMediaPhoto":
            // Can't currently handle a captioned image in Matrix, so
            //   we have to upload this as two separate parts; the
            //   image and its caption
            // See also https://github.com/matrix-org/matrix-doc/issues/906
            return this._handleTelegramPhoto(user, media).then(() => {
                if (update.media.caption) {
                    return user.sendText(this._matrix_room_id, update.media.caption);
                }
            });

        default:
            console.log(`Unrecognised UPDATE media type ${media._}`);
            break;
    }
};

Portal.prototype._handleTelegramPhoto = function(user, media) {
    // Find the largest size
    var largest;
    media.photo.sizes.forEach((size) => {
        if(!largest || size.w > largest.w) largest = size;
    });

    return this.getTelegramGhost().then((ghost) => {
        return ghost.getFile(largest.location);
    }).then((file) => {
        // We don't get a real filename on Telegram, but the Matrix media repo
        //   would quite like one.
        var name = `${largest.location.volume_id}_${largest.location.local_id}.${file.extension}`;

        return user.uploadContent({
            stream: new Buffer(file.bytes),
            name: name,
            type: file.mimetype,
        }).then((response) => {
            return user.sendImage(this._matrix_room_id, {
                content_uri: response.content_uri,
                name: name,
                info: {
                    mimetype: file.mimetype,
                    w: largest.w,
                    h: largest.h,
                    size: largest.size,
                },
            });
        });
    });
};

module.exports = Portal;
