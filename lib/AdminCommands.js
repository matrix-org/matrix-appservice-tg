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
        return main.getOrCreateMatrixUser(opts.user_id).then((u) => {
            console.log("User", u);

            var ghost = u.getTelegramGhost();
            return ghost.sendCode(opts.phone_number);
        }).then(() => {
            console.log("Code sent");
        });
    }
});

module.exports = adminCommands;
