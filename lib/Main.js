"use strict";

var Promise = require("bluebird");

var bridgeLib = require("matrix-appservice-bridge");
var Bridge = bridgeLib.Bridge;
var Metrics = bridgeLib.PrometheusMetrics;

var MatrixUser = require("./MatrixUser"); // NB: this is not bridgeLib.MatrixUser !
var TelegramGhost = require("./TelegramGhost");

var Portal = require("./Portal");

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

    // map (matrix_user_id, peer_type, peer_id) triples to Portal instances
    this._portalsByKey = {};
    // map matrix_room_id to Portal instances
    this._portalsByMatrixId = {};

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

Main.prototype.getMatrixGhostFor = function(telegram_id) {
    // TODO: hardcoded
    return this._bridge.getIntentFromLocalpart("telegram_" + telegram_id);
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

Main.prototype.getOrCreatePortal = function(matrix_user, peer) {
    return this.getPortal(matrix_user, peer, true);
};

Main.prototype.getPortal = function(matrix_user, peer, create) {
    var matrix_user_id = matrix_user.userId();
    var key = [matrix_user_id, peer.getKey()].join(" ");

    // Have we got it in memory already?
    if (this._portalsByKey[key]) return Promise.resolve(this._portalsByKey[key]);

    // Maybe it's in the database?
    return this._bridge.getRoomStore().select({
        type: "portal",
        id: key,
    }).then((entries) => {
        if (this._portalsByKey[key]) return this._portalsByKey[key];

        if(entries.length) {
            var portal = Portal.fromEntry(this, entries[0]);
            if (portal.getMatrixRoomId()) {
                this._portalsByMatrixId[portal.getMatrixRoomId()] = portal;
            }
            return this._portalsByKey[key] = portal;
        }

        if (!create) return null;

        // Create it
        var portal = new Portal(this, {
            matrix_user: matrix_user,
            peer:        peer,
        });
        this._portalsByKey[key] = portal;

        return this.putRoom(portal)
            .then(() => portal);
    });
};

Main.prototype.findPortalByMatrixId = function(matrix_room_id) {
    return this._bridge.getRoomStore().select({
        "data.matrix_room_id": matrix_room_id,
    }).then((entries) => {
        if (!entries.length) return Promise.resolve();

        var portal = Portal.fromEntry(this, entries[0]);

        this._portalsByKey[portal.getKey()] = portal;
        this._portalsByMatrixId[portal.getMatrixRoomId()] = portal;

        return portal;
    });
};

Main.prototype.putUser = function(user) {
    var entry = user.toEntry();
    return this._bridge.getUserStore().upsert(
        {type: entry.type, id: entry.id},
        entry
    );
};

Main.prototype.putRoom = function(room) {
    var entry = room.toEntry();
    return this._bridge.getRoomStore().upsert(
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

    return this.findPortalByMatrixId(ev.room_id).then((room) => {
        if (room) room.onMatrixEvent(ev);
    });
};

Main.prototype.onMatrixAdminMessage = function(ev) {
    var cmd = ev.content.body;

    // Ignore "# comment" lines as chatter between humans sharing the console
    if (cmd.match(/^\s*#/)) return Promise.resolve();

    if (this._config.admin_console_needs_pling) {
        if (!cmd.match(/^!/)) return Promise.resolve();
        cmd = cmd.replace(/^!/, "");
    }

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

Main.prototype.onTelegramUpdate = function(matrix_user, peer, update) {
    // TODO peer gutwrench
    return this.getPortal(matrix_user, peer).then((portal) => {
        if (!portal) {
            console.log(`>> User ${matrix_user.userId()} doesn't appear to have a peer ${peer.getKey()}`);
            return;
        }

        return portal.onTelegramUpdate(update);
    });
};

Main.prototype.run = function(port) {
    var bridge = this._bridge;

    bridge.loadDatabases().then(() => {
        return this._bridge.getUserStore().select({
            type: "matrix",
        });
    }).then((entries) => {
        // Simply getting the user instance is enough to 'start' the telegram
        // client within it

        // TODO: we should rate-limit these on startup
        entries.forEach((entry) => {
            this.getOrCreateMatrixUser(entry.id);
        });
    });

    bridge.run(port, this._config);
};

module.exports = Main;
