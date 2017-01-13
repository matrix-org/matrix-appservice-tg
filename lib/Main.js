"use strict";

var Promise = require("bluebird");

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;
var Metrics = bridgeLib.PrometheusMetrics;

var MatrixUser = require("./MatrixUser"); // NB: this is not bridgeLib.MatrixUser !

var AdminCommands = require("./AdminCommands");

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

            onEvent: (request, context) => {
                var ev = request.getData();
                self.onMatrixEvent(ev);
            },
        }
    });

    this._bridge = bridge;

    // map matrix user ID strings to MatrixUser instances
    this._matrixUsersById = {};

    if (config.enable_metrics) {
        this.initialiseMetrics();
    }
}

Main.prototype.initialiseMetrics = function() {
    var metrics = this._metrics = this._bridge.getPrometheusMetrics();

    metrics.addCounter({
        name: "remote_api_calls",
        help: "Count of the number of remote API calls made",
        labels: ["method"],
    });

    metrics.addTimer({
        name: "matrix_request_seconds",
        help: "Histogram of processing durations of received Matrix messages",
        labels: ["outcome"],
    });
};

Main.prototype.incRemoteCallCounter = function(type) {
    if (!this._metrics) return;
    this._metrics.incCounter("remote_api_calls", {method: type});
};

Main.prototype.startTimer = function(name, labels) {
    if (!this._metrics) return function() {};
    return this._metrics.startTimer(name, labels);
};

Main.prototype.getBotIntent = function() {
    return this._bridge.getIntent();
};

Main.prototype.getOrCreateMatrixUser = function(id) {
    // This is currently a synchronous method but maybe one day it won't be
    var u = this._matrixUsersById[id];
    if (u) return Promise.resolve(u);

    return this._bridge.getUserStore().select({
        type: "matrix",
        id: id,
    }).then((entries) => {
        // in case of multiple racing database lookups, go with the first
        // successful result to avoid multiple objects
        u = this._matrixUsersById[id];
        if (u) return Promise.resolve(u);

        if (entries.length) {
            u = MatrixUser.fromEntry(this, entries[0]);
        }
        else {
            u = new MatrixUser(this, {user_id: id});
        }

        this._matrixUsersById[id] = u;
        return u;
    });
};

Main.prototype.putUser = function(user) {
    var entry = user.toEntry();
    return this._bridge.getUserStore().upsert(
        {type: entry.type, id: entry.id},
        entry
    );
};

Main.prototype.onMatrixEvent = function(ev) {
    var endTimer = this.startTimer("matrix_request_seconds");

    var myUserId = this._bridge.getBot().getUserId();

    if (ev.type === "m.room.member" && ev.state_key === myUserId) {
        // A membership event about myself
        var membership = ev.content.membership;
        if (membership === "invite") {
            // Automatically accept all invitations
            this.getBotIntent().join(ev.room_id).then(
                () => endTimer({outcome: "success"}),
                (e) => {
                    console.log("Failed: ", e);
                    if (e instanceof Error) {
                        console.log(e.stack);
                    }
                    endTimer({outcome: "fail"});
                }
            );
        }
        else {
            // Ignore it
            endTimer({outcome: "success"});
        }
        return;
    }

    if (ev.sender === myUserId || ev.type !== "m.room.message" || !ev.content) {
        endTimer({outcome: "success"});
        return;
    }

    if (this._config.matrix_admin_room && ev.room_id === this._config.matrix_admin_room) {
        this.onMatrixAdminMessage(ev).then(
            () => endTimer({outcome: "success"}),
            (e) => {
                console.log("onMatrixAdminMessage() failed: ", e);
                endTimer({outcome: "fail"});
            }
        );
        return;
    }

    // TODO: handle regular message
};

Main.prototype.onMatrixAdminMessage = function(ev) {
    var cmd = ev.content.body;

    // Ignore "# comment" lines as chatter between humans sharing the console
    if (cmd.match(/^\s*#/)) return;

    console.log("Admin: " + cmd);

    var response = [];
    function respond(message) {
        if (!response) {
            console.log("Command response too late: " + message);
            return;
        }
        response.push(message);
    };
    // Split the command string into optionally-quoted whitespace-separated
    //   tokens. The quoting preserves whitespace within quoted forms
    // TODO(paul): see if there's a "split like a shell does" function we can use
    //   here instead.
    var args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g);
    cmd = args.shift();

    var p;
    var c = AdminCommands[cmd];
    if (c) {
        p = Promise.try(() => {
            return c.run(this, args, respond);
        }).catch((e) => {
            respond("Command failed: " + e);
            console.log("Command failed: " + e);
            if (e instanceof Error) {
                console.log(e.stack);
            }
        });
    }
    else {
        respond("Unrecognised command: " + cmd);
        p = Promise.resolve();
    }

    return p.then(() => {
        if (!response.length) response.push("Done");

        var message = (response.length == 1) ?
            ev.user_id + ": " + response[0] :
            ev.user_id + ":\n" + response.map((s) => "  " + s).join("\n");

        response = null;
        return this.getBotIntent().sendText(ev.room_id, message);
    });
};

Main.prototype.run = function(port) {
    var bridge = this._bridge;

    bridge.run(port, this._config);
};

module.exports = Main;
