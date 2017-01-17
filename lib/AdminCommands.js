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

            return user.getTelegramGhost().checkPassword(new Buffer(opts.password_hash, "hex"));
        }).then(() => {
            respond("User signed in via 2FA");
        });
    }
});

// These are temporary debugging / testing commands that implement a few bits
//   of telegram client ability

var TelegramLink = require('@goodmind/telegram.link')();

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
            //   * chats - the targets of multi-participant dialogs

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
                    console.log(`   - peer=channel <> = ${peer.channel_id}`);
                }
                else {
                    console.log(d);
                }
            });
        });
    }
});

adminCommands.U_getContacts = new AdminCommand({
    desc: "USER: Returns the current user's contact list",
    opts: {
        user_id: {
            descriptionn: "Matrix user ID",
        },
    },
    args: ["user_id"],

    func: function(main, opts, _, respond) {
        return _getGhostClient(main, opts.user_id).then((client) => {
            return client.contacts.getContacts("");
        }).then((result) => {
            var users = result.users;

            console.log("Users:");
            users.list.forEach((u) => {
                console.log(`User: <id=${u.id} name=${u.first_name} ${u.last_name} / @${u.username}`);
            });
        });
    }
});

adminCommands.U_sendMessage = new AdminCommand({
    desc: "USER: Sends a text message",
    opts: {
        user_id: {
            description: "Sending user's Matrix user ID",
        },
        peer: {
            description: "Type of the peer - user, chat, channel",
        },
        peer_id: {
            description: "Peer's ID",
        },
        access_hash: {
            description: "Access hash for the peer",
        },
    },
    args: ["user_id", "peer"],

    func: function(main, opts, args, respond) {
        var peer;
        if (opts.peer == "self") {
            peer = new TelegramLink.type.InputPeerSelf();
        }
        else {
            var peer_id = args.shift();
            if (!peer_id) throw new Error("Require peer_id");

            var access_hash = new Buffer(opts.access_hash || "", "hex");

            if (opts.peer == "user") {
                peer = new TelegramLink.type.InputPeerUser({props: {
                    user_id: peer_id,
                    access_hash: access_hash,
                }});
            }
            else if (opts.peer == "chat") {
                peer = new TelegramLink.type.InputPeerChat({props: {
                    chat_id: peer_id,
                }});
            }
            else if (opts.peer == "channel") {
                peer = new TelegramLink.type.InputPeerChannel({props: {
                    channel_id: peer_id,
                    access_hash: access_hash,
                }});
            }
            else {
                throw new Error("Unrecognised peer type");
            }
        }

        var message = args.join(" ");

        return _getGhostClient(main, opts.user_id).then((client) => {
            return client.messages.sendMessage(peer, message, Math.random() * (1<<30), null, null, null);
        }).then((result) => {
            respond("Sent; id=" + result.id);
        });
    }
});

module.exports = adminCommands;
