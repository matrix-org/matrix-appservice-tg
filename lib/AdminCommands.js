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

var AdminCommand = require("./AdminCommand");

var adminCommands = {};

adminCommands.help = AdminCommand.makeHelpCommand(adminCommands);

adminCommands.auth_send_code = new AdminCommand({
    desc: "Send an authentication code to the user's device",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
        phone_number: {
            description: "Phone number"
        },
    },
    args: ["user_id", "phone_number"],

    func: function(main, opts, _, respond) {
        var phone_number = String(opts.phone_number);

        return main.getOrCreateMatrixUser(opts.user_id).then((user) => {
            return user.sendCodeToTelegram(phone_number);
        }).then(() => {
            respond("Code sent to user's device");
        });
    }
});

adminCommands.auth_sign_in = new AdminCommand({
    desc: "Sign in to Telegram using an authentication code",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
        phone_code: {
            description: "Phone code sent to the user's device",
        },
    },
    args: ["user_id", "phone_code"],

    func: function(main, opts, _, respond) {
        var user;

        return main.getOrCreateMatrixUser(opts.user_id).then((_user) => {
            user = _user;

            return user.signInToTelegram(String(opts.phone_code));
        }).then((result) => {
            if (result) {
                // 2FA required - print salt
                respond("2FA required: hint:" + result.hint);
                respond("  Salt: " + result.current_salt.toString("hex"));
            }
            else {
                respond("User signed in");
            }
        });
    }
});

adminCommands.auth_check_password = new AdminCommand({
    desc: "Complete the 2FA login process",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
        password_hash: {
            description: "Hex encoding of SHA256 salted password hash",
        },
    },
    args: ["user_id", "password_hash"],

    func: function(main, opts, _, respond) {
        var user;

        return main.getOrCreateMatrixUser(opts.user_id).then((_user) => {
            user = _user;

            return user.checkPassword(new Buffer(opts.password_hash, "hex"));
        }).then(() => {
            respond("User signed in via 2FA");
        });
    }
});

adminCommands.user_list_chats = new AdminCommand({
    desc: "List available chats for a user",
    opts: {
        user_id: {
            description: "Matrix user ID",
        }
    },
    args: ["user_id"],

    func: function(main, opts, _, respond) {
        return _getGhostClient(main, opts.user_id).then((client) => {
            return client("messages.getDialogs", {
                    offset_date: 0,
                    offset_id:   0,
                    limit:       100,
            });
        }).then((ret) => {
            var chats_by_id = {};
            ret.chats.forEach((chat) => chats_by_id[chat.id] = chat);

            ret.dialogs.forEach((d) => {
                var peer = d.peer;
                if (peer._ !== "peerChat") return;

                var chat = chats_by_id[peer.chat_id];
                if (chat.deactivated) return;

                respond(`Chat ${chat.id}: ${chat.title} (${chat.participants_count})`);
            });
        });
    }
});

adminCommands.user_list_channels = new AdminCommand({
    desc: "List available channels for a user",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
    },
    args: ["user_id"],

    func: function(main, opts, _, respond) {
        var client;

        return _getGhostClient(main, opts.user_id).then((_client) => {
            client = _client;

            return client("messages.getDialogs", {
                offset_date: 0,
                offset_id:   0,
                limit:       100,
            });
        }).then((ret) => {
            var chats_by_id = {};
            ret.chats.forEach((chat) => chats_by_id[chat.id] = chat);

            ret.dialogs.forEach((d) => {
                var peer = d.peer;
                if (peer._ !== "peerChannel") return;

                // Despite being called 'chats', this list also contains
                //   channels. This is fine because their ID numbers are in
                //   disjoint ranges.
                var channel = chats_by_id[peer.channel_id];

                respond(`Channel ${channel.id}: ${channel.title} #${channel.access_hash}`);
            });
        });
    }
});

adminCommands.user_mk_portal = new AdminCommand({
    desc: "Create a new portal room for a given peer",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
        peer_type: {
            description: "Peer type (currently only chat supported)",
        },
        peer_id: {
            description: "ID of the peer",
        },
        access_hash: {
            description: "Access hash for the peer",
        },
    },
    args: ["user_id", "peer_id"],

    func: function(main, opts, _, respond) {
        var user;
        var access_hash;

        var peer_type = opts.peer_type || "chat";
        switch (peer_type) {
            case "user":
            case "channel":
                if (!opts.access_hash) throw new Error("Require an --access_hash for " + peer_type);

                opts.access_hash = opts.access_hash.replace(/^#/, "");
                access_hash = new Buffer(opts.access_hash);
                /* fallthrough */
            case "chat":
                break;

            default:
                throw new Error("Unrecognised peer type '" + peer_type);
        }

        console.log("access_hash:", access_hash);

        return main.getOrCreateMatrixUser(opts.user_id).then((_user) => {
            user = _user;
            return user.getTelegramGhost();
        }).then((ghost) => {
            var peer;
            switch (peer_type) {
                case "user":
                    throw new Error("TODO");
                case "chat":
                    peer = ghost.newChatPeer(opts.peer_id);
                    break;
                case "channel":
                    peer = ghost.newChannelPeer(opts.peer_id, access_hash);
                    break;
            }
            return main.getOrCreatePortal(user, peer);
        }).then((portal) => {
            return portal.provisionMatrixRoom().then(() => portal);
        }).then((portal) => {
            respond("Portal room ID is " + portal.getMatrixRoomId());
        });
    }
});

adminCommands.user_fix_portal = new AdminCommand({
    desc: "Check and fix metadata for a portal room",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
        room_id: {
            description: "Matrix room ID of an existing portal",
        },
    },
    args: ["user_id", "room_id"],

    func: function(main, opts, _, respond) {
        return Promise.all([
            main.getOrCreateMatrixUser(opts.user_id),
            main.findPortalByMatrixId(opts.room_id),
        ]).spread((user, portal) => {
            if (!portal) throw new Error("No such portal room");
            if (portal._matrix_user_id !== user.userId()) throw new Error("This portal does not belong to this user");

            return portal.fixMatrixRoom();
        });
    }
});

adminCommands.leave = new AdminCommand({
    desc: "leave a (stale) matrix room",
    opts: {
        room_id: {
            description: "Matrix room ID of the stale room",
        },
    },
    args: ["room_id"],
    func: function(main, opts, _, respond) {
        var room_id = opts.room_id;
        // TODO: safety test

        // TODO: consider some sort of warning about the count of ghost users
        //   to be removed if it's large...
        return main.listGhostUsers(room_id).then((user_ids) => {
            respond("Draining " + user_ids.length + " ghosts from " + room_id);

            return Promise.each(user_ids, (user_id) => {
                return main._bridge.getIntent(user_id).leave(room_id);
            });
        }).then(() => {
            return main.getBotIntent().leave(room_id);
        }).then(() => {
            respond("Drained and left " + room_id);
        });
    },
});

// These are temporary debugging / testing commands that implement a few bits
//   of telegram client ability

function _getGhostClient(main, user_id) {
    return main.getOrCreateMatrixUser(user_id).then((user) => {
        // gutwrench
        return user.getTelegramGhost()._getClient();
    });
}

module.exports = adminCommands;
