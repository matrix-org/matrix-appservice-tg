"use strict";

var TelegramLink = require("telegram.link")();
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
    connectionType: "HTTP",
};

function TelegramGhost(opts) {
    this._main = opts.main;

    this._client = null;
    this._phoneNumber = null;
}

// These internal functions basically just wrap the underlying TelegramLink
//   methods in promise-returning wrappers. While most TelegramLink object
//   methods already return promises, there's a few that don't.

function _isError(result) { return result.instanceOf("mtproto.type.Rpc_error"); }

function _createAuthKey(client) {
    return new Promise(function (fulfill, reject) {
        client.once('error', reject);
        client.createAuthKey((auth) => {
            client.removeListener('error', reject);
            fulfill(auth);
        });
    });
}

function _getDataCenters(client) {
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
    dc = dc || TelegramLink.PROD_PRIMARY_DC;

    // TODO: check that dc matches
    if (this._client) return Promise.resolve(this._client);

    var main = this._main;

    var p = new Promise(function (fulfill, reject) {
        main.incRemoteCallCounter("connect");
        var client = TelegramLink.createClient(APP, dc);
        client.once('connect', () => {
            client.removeListener('error', reject);
            fulfill(client);
        });
        client.once('error', reject);
    });
    return p.then((client) => {
        this._main.incRemoteCallCounter("createAuthKey");
        return _createAuthKey(client).then(() => {
            this._client = client;
            return client;
        });
    });
};

// A utility that handles a 303 redirection to a request and migrates to the
//   requested data centre.
TelegramGhost.prototype._doWithRedirect = function(func) {
    return this._getClient().then((client) => {
        return func(client).catch((message) => {
            // The error message will contain the index number of the DC we're
            // asked to migrate to. Yes... this makes me sad.
            var match = message.match(/^PHONE_MIGRATE_(\d+)$/);
            if (!match) throw new Error(message);

            var index = match[1];
            console.log(">> Redirected to data centre " + index);

            this._main.incRemoteCallCounter("getDataCenters");
            return _getDataCenters(client).then((datacenters) => {
                var dc = datacenters["DC_" + index];
                this._client = null;
                return this._getClient(dc);
            }).then((client) => {
                return func(client);
            });
        });
    });
};

var SEND_CODE_SMS = 0;
var SEND_CODE_TELEGRAM = 5;

TelegramGhost.prototype.sendCode = function(phone_number) {
    var main = this._main;

    return this._doWithRedirect((client) => {
        return new Promise(function (fulfill, reject) {
            main.incRemoteCallCounter("auth.sendCode");
            client.auth.sendCode(phone_number, SEND_CODE_TELEGRAM, "en");
            client.once('error', reject);

            client.once('sendCode', (result) => {
                if (_isError(result)) { reject(result.error_message); }
                else                  { fulfill(result); }
            });
        });
    });
};

TelegramGhost.prototype.signIn = function(phone_number, phone_code_hash, phone_code) {
    return this._doWithRedirect((client) => {
        this._main.incRemoteCallCounter("auth.signIn");
        return client.auth.signIn(phone_number, phone_code_hash, phone_code)
    }).then((result) => {
        // TODO(paul): see if there's any useful information we can get out of
        //   result

        this._phoneNumber = phone_number;
    });
};

module.exports = TelegramGhost;
