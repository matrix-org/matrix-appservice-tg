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

        return main.getOrCreateMatrixUser(opts.user_id).then((u) => {
            var ghost = u.getTelegramGhost();
            return ghost.sendCode(phone_number);
        }).then(
            (result) => {
                console.log("Code sent; result:", result);
            },
            (err) => {
                console.log("Failed to send code:", err.toPrintable ? err.toPrintable() : err);
            }
        );
    }
});

module.exports = adminCommands;
