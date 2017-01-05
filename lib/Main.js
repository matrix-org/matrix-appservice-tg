"use strict";

var Promise = require("bluebird");

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;

function Main(config) {
    var self = this;

    this._config = config;

    var bridge = new Bridge({
        homeserverUrl: config.matrix_homeserver,
        domain: config.matrix_user_domain,
        registration: "telegram-registration.yaml",
        controller: {
            onUserQuery: function(queriedUser) {
                return {}; // auto-provision users with no additonal data
            },

            onEvent: (req, context) => {
            },
        }
    });

    this._bridge = bridge;
}

Main.prototype.run = function(port) {
    var bridge = this._bridge;

    bridge.run(port, this._config);
};

module.exports = Main;
