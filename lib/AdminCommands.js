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

        var user;

        return main.getOrCreateMatrixUser(opts.user_id).then((_user) => {
            user = _user;

            var ghost = user.getTelegramGhost();
            return ghost.sendCode(phone_number);
        }).then(
            (result) => {
                console.log("Code sent; result:", result);

                user.setPhoneNumber(phone_number);
                user.setPhoneCodeHash(result.phone_code_hash);
                return main.putUser(user).then(() => {
                    respond("Code sent to user's device");
                });
            },
            (err) => {
                var message = err.toPrintable ? err.toPrintable() : err.toString();

                console.log("Failed to send code:", message);
                throw new Error(message);
            }
        );
    }
});

module.exports = adminCommands;
