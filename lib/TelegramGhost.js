"use strict";

var TelegramLink = require("@goodmind/telegram.link")();
var Promise = require("bluebird");

var os = require("os");

// As registered at
//   https://my.telegram.org/auth?to=apps
var APP = {
    id: "57582",
    hash: "7e085c887f71c9f1480c3930547ac159",
    version: "0.0.1",
    langCode: "en",
    deviceModel: os.type().replace("Darwin", "OS_X"),
    systemVersion: os.platform() + "/" + os.release(),
    connectionType: "HTTP",  // Cannot currently use TCP - see https://github.com/goodmind/telegram.link/issues/13
};

// The Telegram 'help.getConfig' API seems to lie about what the data center
//   IPs actually are. We can avoid this breakage by just keeping a hardcoded
//   list here. Yes, this sucks.
//     https://github.com/goodmind/telegram.link/issues/16
var DATA_CENTERS = {
    DC_1: {host: '149.154.175.50', port: 80},
    DC_2: {host: '149.154.167.51', port: 80},
    DC_3: {host: '149.154.175.100', port: 80},
    DC_4: {host: '149.154.167.91', port: 80},
    DC_5: {host: '149.154.171.5', port: 80},
};

function TelegramGhost(opts) {
    this._main = opts.main;

    this._client = null;

    this._dataCenter = opts.data_center || TelegramLink.PROD_PRIMARY_DC;
    this._authKey = null;
    this._phoneNumber = null;

    if (opts.auth_key_buffer && opts.auth_key_password) {
        this._authKey = TelegramLink.retrieveAuthKey(opts.auth_key_buffer, opts.auth_key_password);
    }
}

TelegramGhost.prototype.getDataCenter = function() {
    return this._dataCenter;
};

TelegramGhost.prototype.getAuthKey = function(password) {
    if (!this._authKey) return null;

    return this._authKey.encrypt(password);
};

// These internal functions basically just wrap the underlying TelegramLink
//   methods in promise-returning wrappers. While most TelegramLink object
//   methods already return promises, there's a few that don't.

function _isError(result) { return result.instanceOf("mtproto.type.Rpc_error"); }

function _createAuthKey(client) {
    return new Promise(function (fulfill, reject) {
        client.once('error', reject);
        client.createAuthKey((auth) => {
            console.log("<< Auth key created");
            client.removeListener('error', reject);
            fulfill(auth);
        });
    });
}

function _getDataCenters(client) {
    // Send hardcoded response
    return Promise.resolve(DATA_CENTERS);

    return new Promise(function (fulfill, reject) {
        client.once('error', reject);
        client.getDataCenters((datacenters) => {
            client.removeListener('error', reject);
            fulfill(datacenters);
        });
    });
}

// Internal methods that use theabove
TelegramGhost.prototype._getClient = function(dc) {
    dc = dc || this._dataCenter;

    // TODO: check that dc matches
    if (this._client) return Promise.resolve(this._client);

    var main = this._main;

    // TelegramLink takes the authKey as a field of the (otherwise-static) app
    //   configuration. We'll have to clone it. *grumble*
    var keyed_app = Object.assign({
        authKey: this._authKey,
    }, APP);

    var p = new Promise(function (fulfill, reject) {
        main.incRemoteCallCounter("connect");
        var client = TelegramLink.createClient(keyed_app, dc);
        client.once('connect', () => {
            client.removeListener('error', reject);
            fulfill(client);
        });
        client.once('error', reject);
    });

    if (keyed_app.authKey) {
        console.log("> Reusing existing auth key", keyed_app.authKey);

        return p.then((client) => {
            this._client = client;
            this._dataCenter = dc;
            console.log("< Client ready");
            return client;
        });
    }

    return p.then((client) => {
        console.log("> Creating new auth key");

        this._main.incRemoteCallCounter("createAuthKey");
        return _createAuthKey(client).then((auth) => {
            this._client = client;
            this._dataCenter = dc;

            // Don't save the auth key *yet* until we're signed in
            // But now's the only time we see it, so we have to keep it somewhere
            this._potentialAuthKey = auth.key;
            console.log("< Client ready");
            return client;
        });
    });
};

// A utility that handles a 303 redirection to a request and migrates to the
//   requested data centre.
TelegramGhost.prototype._doWithRedirect = function(func) {
    return this._getClient().then((client) => {
        return func(client).catch((message) => {
            if (message instanceof Error) throw message;
            if (typeof message !== "string") throw new Error(message);

            // The error message will contain the index number of the DC we're
            // asked to migrate to. Yes... this makes me sad.
            var match = message.match(/^PHONE_MIGRATE_(\d+)$/);
            if (!match) throw new Error(message);

            var index = match[1];

            this._main.incRemoteCallCounter("getDataCenters");
            return _getDataCenters(client).then((datacenters) => {
                var dc = datacenters["DC_" + index];
                console.log(">> Redirected to data centre " + index + " at " +
                        `${dc.host}:${dc.port}`);

                this._client = null;
                return this._getClient(dc);
            }).then((client) => {
                return func(client);
            });
        });
    });
};

TelegramGhost.prototype.sendCode = function(phone_number) {
    var main = this._main;

    return this._doWithRedirect((client) => {
        return new Promise(function (fulfill, reject) {
            console.log("> Requesting auth code");
            main.incRemoteCallCounter("auth.sendCode");

            // Must install 'error' handler *BEFORE* call in case of synchronous emit
            client.once('error', (result) => {
                console.log("< auth.sendCode failure", result);
                reject(result);
            });
            client.once('sendCode', (result) => {
                console.log("< auth.sendCode result", result);
                if (_isError(result)) { reject(result.error_message); }
                else                  { fulfill(result); }
            });

            client.auth.sendCode(
                /* phone_number: */    phone_number,
                /* current_number: */  new TelegramLink.type.BoolTrue(),
                /* allow_flashcall: */ new TelegramLink.type.BoolFalse()
            );
        });
    });
};

function _handleAuthorization(authorization) {
    // TODO(paul): see if there's any useful information we can get out of
    //   result

    this._authKey = this._potentialAuthKey;

    return null;
}

TelegramGhost.prototype.signIn = function(phone_number, phone_code_hash, phone_code) {
    return this._doWithRedirect((client) => {
        this._main.incRemoteCallCounter("auth.signIn");
        this._phoneNumber = phone_number;
        return client.auth.signIn(phone_number, phone_code_hash, phone_code)
    }).then(
        // Login succeeded - user is not using 2FA
        (result) => _handleAuthorization.bind(this),
        (err) => {
            console.log("Failed: wonder if session password needed??", err);

            if (!(err instanceof Error) ||
                err.message !== "SESSION_PASSWORD_NEEDED") {
                // Something else went wrong
                throw err;
            }

            this._authKey = this._potentialAuthKey;

            // User is using 2FA - more steps are required
            return this._doWithRedirect((client) => {
                this._main.incRemoteCallCounter("account.getPassword");
                return client.account.getPassword();
            });
        }
    );
};

TelegramGhost.prototype.checkPassword = function(password_hash) {
    return this._doWithRedirect((client) => {
        this._main.incRemoteCallCounter("auth.checkPassword");
        return client.auth.checkPassword(password_hash);
    }).then((result) => _handleAuthorization.bind(this));
};

module.exports = TelegramGhost;
