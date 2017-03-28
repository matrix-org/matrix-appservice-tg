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
    DC_1: {host: '149.154.175.50', port: 443},
    DC_2: {host: '149.154.167.51', port: 443},
    DC_3: {host: '149.154.175.100', port: 443},
    DC_4: {host: '149.154.167.91', port: 443},
    DC_5: {host: '149.154.171.5', port: 443},
};

// Maximum wait time for HTTP long-poll
var HTTP_MAXWAIT = 30 * 1000;  // 30 seconds

function TelegramGhost(opts) {
    this._main = opts.main;

    this._matrix_user = opts.matrix_user;

    this._client = null;

    this._user_id = opts.user_id || null;
    this._dataCenter = opts.data_center || TelegramLink.PROD_PRIMARY_DC;
    this._authKey = opts.auth_key;
    this._phoneNumber = null;

    if (this._authKey) this.start();
}

TelegramGhost.fromSubentry = function(matrix_user, main, data) {
    var auth_key =  data.auth_key ?
        // TODO: gutwrenching 'config' out of main
        TelegramLink.retrieveAuthKey(new Buffer(data.auth_key, 'base64'), main._config.auth_key_password) :
        null;

    return new TelegramGhost({
        main: main,
        matrix_user: matrix_user,

        user_id: data.user_id,
        data_center: data.data_center,
        auth_key: auth_key,
    });
};

TelegramGhost.prototype.toSubentry = function() {
    var auth_key = this._authKey ?
        // TODO: gutwrenching 'config' out of main
        this._authKey.encrypt(this._main._config.auth_key_password).toString('base64') :
        null;

    return {
        user_id: this._user_id,
        data_center: this._dataCenter,
        auth_key: auth_key,
    };
};

TelegramGhost.prototype.start = function() {
    this._getClient().then((client) => {
        client.registerOnUpdates(this._onTelegramUpdate.bind(this));

        // TODO: Only do this if we're using HTTP
        client.startHttpPollLoop(null, HTTP_MAXWAIT);

        // You have to call updates.getState() once on startup for your
        //   session to be able to receive updates at all

        client.account.updateStatus(false).then(() => {
            return client.updates.getState();
        }).then((state) => {
            console.log("Got initial state:", state);
        });

        console.log("STARTed");
    }).catch((err) => {
        console.log("Failed to START -", err);
    });
};

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
        console.log("> Reusing existing auth key");

        return p.then((client) => {
            this._client = client;
            this._dataCenter = dc;
            console.log("< Client ready");
            return client;
        });
    }

    // TODO: make this race-safe

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

            console.log("> Redirecting to DC " + index);

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

TelegramGhost.prototype.sendCode = function(phone_number) {
    var main = this._main;

    return this._doWithRedirect((client) => {
        return new Promise(function (fulfill, reject) {
            console.log("> Requesting auth code");
            main.incRemoteCallCounter("auth.sendCode");

            // Must install 'error' handler *BEFORE* call in case of synchronous emit
            client.once('error', (result) => {
                reject(result);
            });
            client.once('sendCode', (result) => {
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

TelegramGhost.prototype._handleAuthorization = function(authorization) {
    this._user_id = authorization.user.id;
    this._authKey = this._potentialAuthKey;
    this.start();

    return null;
}

TelegramGhost.prototype.signIn = function(phone_number, phone_code_hash, phone_code) {
    return this._doWithRedirect((client) => {
        this._main.incRemoteCallCounter("auth.signIn");
        this._phoneNumber = phone_number;
        return client.auth.signIn(phone_number, phone_code_hash, phone_code)
    }).then(
        // Login succeeded - user is not using 2FA
        (result) => this._handleAuthorization(result),
        (err) => {
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
    }).then((result) => this._handleAuthorization(result));
};

TelegramGhost.prototype.sendMessage = function(peer, text) {
    // TODO: reliable message IDs

    if (peer._type !== "chat") throw new Error("TODO: can only use chat peers for now");

    var peerobj = new TelegramLink.type.InputPeerChat({props: {
        chat_id: peer._id,
    }});

    return this._doWithRedirect((client) => {
        return client.messages.sendMessage(peerobj, text, Math.random() * (1<<30), null, null, null);
    }).then((result) => {
        // TODO: store result.id somewhere
    });
};

TelegramGhost.prototype.getChatInfo = function(peer) {
    if (peer._type === "user") throw new Error("Cannot get chat info on users");


    return this._getClient().then((client) => {
        // For a chat, getFullChat really does that
        if (peer._type === "chat"   ) return Promise.all([
            client.messages.getFullChat(peer._id),
            Promise.resolve(null),
        ]);
        // For a channel, getFullChannel doesn't return participants, so we need to make two calls
        if (peer._type === "channel") return Promise.all([
            client.channels.getFullChannel(peer.toInputChannel()),
            client.channels.getParticipants(
                /* channel: */ peer.toInputChannel(),
                /* filter: */  new TelegramLink.type.ChannelParticipantsRecent(),
                /* offset: */  0,
                /* limit: */   1000),
        ]);
        throw new Error("Impossible");
    }).spread((ret, participants) => {
        console.log("ChannelInfo was", ret, participants);

        // Assemble all the useful information about the chat
        var users = participants ? participants.users : ret.users;
        var chat = ret.chats.list[0];

        if (!participants) participants = ret.full_chat.participants;

        return {
            title:        chat.title,
            participants: participants.participants.list.map((p) => users.getById(p.user_id)),
        };
    });
};

TelegramGhost.prototype._onTelegramUpdate = function(upd) {
    // The structure here has many possibilities
    var type = upd.getTypeName().replace(/^api\.type\./, "");

    switch(type) {
        case "UpdateShort":
            this._onOneUpdate(upd.update);
            break;

        case "Updates":
            var users = upd.users;

            upd.updates.list.forEach((update) => {
                this._onOneUpdate(update, {
                    users: users,
                });
            });
            break;

        case "UpdateShortChatMessage":
            this._onOneUpdate(upd);
            break;

        default:
            console.log(`TODO: unrecognised updates toplevel type ${type}:`);
            break;
    }
};

TelegramGhost.prototype._onOneUpdate = function(update, hints) {
    hints = hints || {};

    var type = update.getTypeName().replace(/^api\.type\./, "");

    switch(type) {
        // Updates about Users
        case "UpdateUserStatus":
        case "UpdateUserTyping":
            // Quiet these for now as they're getting really noisy
            //console.log(`UPDATE: user status user_id=${update.user_id} _t=${update.status._typeName}`);
            break;

        // Updates about Chats
        case "UpdateChatUserTyping":
        case "UpdateShortChatMessage":
        {
            console.log(`UPDATE about CHAT ${update.chat_id}`);
            var peer = this.newChatPeer(update.chat_id);

            hints.from_id = update.from_id;

            this._main.onTelegramUpdate(this._matrix_user, peer, update, hints);
            break;
        }

        // Updates about Channels
        //   - where the channel ID is part of the 'message'
        case "UpdateNewChannelMessage":
        case "UpdateEditChannelMessage":
        {
            console.log(`UPDATE about CHANNEL ${update.message.to_id.channel_id}`);
            var peer = new Peer("channel", update.message.to_id.channel_id);

            if (update.message.out) {
                // Channel messages from myself just have the "out" flag and
                // omit the from_id
                hints.from_id = this._user_id;
            }
            else {
                hints.from_id = update.message.from_id;
            }

            this._main.onTelegramUpdate(this._matrix_user, peer, update, hints);
            break;
        }

        //   - where the channel ID is toplevel
        case "UpdateReadChannelInbox":
        {
            console.log(`UPDATE about CHANNEL ${update.channel_id}`);
            var peer = new Peer("channel", update.channel_id);

            this._main.onTelegramUpdate(this._matrix_user, peer, update, hints);
            break;
        }

        // Updates about myself
        case "UpdateReadHistoryInbox":
        case "UpdateReadHistoryOutbox":
            // ignore it for now
            break;

        default:
            console.log(`TODO: unrecognised update type ${type}:`, update);
            break;
    }
};

// A "Peer" is a little helper object that stores a type (user|chat|channel),
//   its ID and the access_hash used to prove this user can talk to it

TelegramGhost.prototype.newChatPeer = function(id) {
    return new Peer("chat", id);
};

TelegramGhost.prototype.newChannelPeer = function(id, access_hash) {
    return new Peer("channel", id, access_hash);
};

function Peer(type, id, access_hash) {
    this._type        = type;
    this._id          = id;
    this._access_hash = access_hash;
}

Peer.fromSubentry = function(entry) {
    return new Peer(entry.type, entry.id, entry.access_hash);
};

Peer.prototype.toSubentry = function() {
    return {
        type:        this._type,
        id:          this._id,
        access_hash: this._access_hash,
    };
};

Peer.prototype.getKey = function() {
    return [this._type, this._id].join(" ");
};

Peer.prototype.toInputChannel = function() {
    if (this._type !== "channel") throw new Error(`Cannot .toInputChannel() a peer of type ${this._type}`);

    return new TelegramLink.type.InputChannel({props: {
        channel_id:  this._id,
        access_hash: this._access_hash,
    }});
}

module.exports = TelegramGhost;
TelegramGhost.Peer = Peer;
