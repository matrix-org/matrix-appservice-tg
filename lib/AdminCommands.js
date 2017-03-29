"use strict";

var Promise = require("bluebird");

var AdminCommand = require("./AdminCommand");

var TelegramLink = require('@goodmind/telegram.link')();

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
            return client.messages.getDialogs(
                    /* offset_date: */ 0,
                    /* offset_id: */   0,
                    /* offset_peer: */ new TelegramLink.type.InputPeerEmpty(),
                    /* limit: */       100
            );
        }).then((ret) => {
            ret.dialogs.list.forEach((d) => {
                var peer = d.peer;
                if (peer.getTypeName() !== "api.type.PeerChat") return;

                var chat = ret.chats.getById(peer.chat_id);
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

            return client.messages.getDialogs(
                    /* offset_date: */ 0,
                    /* offset_id: */   0,
                    /* offset_peer: */ new TelegramLink.type.InputPeerEmpty(),
                    /* limit: */       100
            );
        }).then((ret) => {
            ret.dialogs.list.forEach((d) => {
                var peer = d.peer;
                if (peer.getTypeName() !== "api.type.PeerChannel") return;

                // Despite being called 'chats', this list also contains
                //   channels. This is fine because their ID numbers are in
                //   disjoint ranges.
                var channel = ret.chats.getById(peer.channel_id);

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

        var peer_type = opts.peer_type || "chat";
        switch (peer_type) {
            case "user":
            case "channel":
                if (!opts.access_hash) throw new Error("Require an --access_hash for " + peer_type);

                if (!opts.access_hash.match(/^0x/)) {
                    opts.access_hash = "0x" + opts.access_hash;
                }

                /* fallthrough */
            case "chat":
                break;

            default:
                throw new Error("Unrecognised peer type '" + peer_type);
        }

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
                    peer = ghost.newChannelPeer(opts.peer_id, opts.access_hash);
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

adminCommands.U_getDialogs = new AdminCommand({
    desc: "USER: Returns a list of the current user's conversations",
    opts: {
        user_id: {
            description: "Matrix user ID",
        },
    },
    args: ["user_id"],

    func: function(main, opts, _, respond) {
        return _getGhostClient(main, opts.user_id).then((client) => {
            return client.messages.getDialogs(
                /* offset_date: */ 0,
                /* offset_id: */   0,
                /* offset_peer: */ new TelegramLink.type.InputPeerEmpty(),
                /* limit: */       100
            );
        }).then((ret) => {
            // Despite being called getDialogs, we get a list of
            //   * dialogs - the actual conversations, which have users or chats as peers
            //   * users - the targets of 1:1 dialogs
            //   * chats - the targets of multi-participant dialogs, be they actual chats or channels

            console.log(ret.dialogs.list.length + " dialogs:");
            ret.dialogs.list.forEach((d) => {
                var peer = d.peer;
                console.log(` - dialog`);

                if (peer && peer.user_id) {
                    var u = ret.users.getById(peer.user_id);
                    console.log(`   - peer=user <${u.username}> = ${u.id} #${u.access_hash}`);
                }
                else if (peer && peer.chat_id) {
                    var c = ret.chats.getById(peer.chat_id);
                    console.log(`   - peer=chat <${c.title}> (${c.participants_count}) = ${c.id}`);
                }
                else if (peer && peer.channel_id) {
                    // Despite being a channel this still comes from the chats list
                    var c = ret.chats.getById(peer.channel_id);
                    console.log(`   - peer=channel <${c.title}> = ${c.id} #${c.access_hash}`);
                }
                else {
                    console.log(d);
                }
            });
        });
    }
});

module.exports = adminCommands;
