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

module.exports = adminCommands;
