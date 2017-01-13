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
        }).then(() => {
            respond("User signed in");
        });
    }
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
            return client.messages.getDialogs(0, 0, 58);
        }).then((ret) => {
            // Despite being called getDialogs, we get a list of
            //   * dialogs - the actual conversations, which have users or chats as peers
            //   * users - the targets of 1:1 dialogs
            //   * chats - the targets of multi-participant dialogs

            respond("Total " + ret.count);

            console.log(ret.dialogs.list.length + " dialogs:");
            ret.dialogs.list.forEach((d) => {
                var peer = d.peer;
                console.log(` - dialog`);

                if (peer && peer.user_id) {
                    var u = ret.users.getById(peer.user_id);
                    console.log(`   - peer<user_id=${peer.user_id}>=user <${u.username}> = ${u.id} #${u.access_hash}`);
                }
                else if (peer && peer.chat_id) {
                    var c = ret.chats.getById(peer.chat_id);
                    console.log(`   - peer=chat <${c.title}> (${c.participants_count}) = ${c.id}`);
                }
                else {
                    console.log(d);
                }
            });
        });
    }
});

var TelegramLink = require('telegram.link')();

adminCommands.U_sendMessage = new AdminCommand({
    desc: "USER: Sends a text message",
    opts: {
        user_id: {
            description: "Sending user's Matrix user ID",
        },
    },
    args: ["user_id"],

    func: function(main, opts, args, respond) {
        var peer = new TelegramLink.type.InputPeerSelf();
        var message = args.join(" ");

        return _getGhostClient(main, opts.user_id).then((client) => {
            console.log("Sending message <", message, "> to", peer);

            return client.messages.sendMessage(peer, message, Math.random() * (1<<30))
        }).then((result) => {
            console.log("Got result", result);
        });
    }
});

module.exports = adminCommands;
