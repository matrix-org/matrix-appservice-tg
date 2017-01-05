"use strict";

var Promise = require("bluebird");

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;
var Metrics = bridgeLib.PrometheusMetrics;

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

    if (config.enable_metrics) {
        this.initialiseMetrics();
    }
}

Main.prototype.initialiseMetrics = function() {
    var metrics = this._metrics = this._bridge.getPrometheusMetrics();

    // TODO: add more
};

Main.prototype.run = function(port) {
    var bridge = this._bridge;

    bridge.run(port, this._config);
};

module.exports = Main;
