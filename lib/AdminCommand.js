"use strict";

var minimist = require("minimist");

function AdminCommand(opts) {
    this.desc = opts.desc;
    this._func = opts.func;

    this.optspec = {};
    this.optaliases = {};

    if (opts.opts) {
        Object.keys(opts.opts).forEach((name) => {
            var def = opts.opts[name];

            this.optspec[name] = {
                desc: def.description,
                required: def.required || false,
            }

            if (def.aliases) {
                def.aliases.forEach((a) => this.optaliases[a] = name);
            }
        });
    }

    if (opts.args) {
        opts.args.forEach((name) => {
            if (!this.optspec[name]) {
                throw new Error("AdminCommand does not have an option called '" + name + "'");
            }

            this.optspec[name].required = true;
        });

        this.argspec = opts.args;
    }
}

AdminCommand.prototype.run = function(main, args, respond) {
    var opts = minimist(args, {
        // TODO- would be neater with
        //   https://github.com/substack/minimist/pull/109
        string: Object.keys(this.optspec),
    });

    args = opts._;
    delete opts["_"];

    // Canonicalise aliases
    Object.keys(this.optaliases).forEach((a) => {
        if (a in opts) {
            opts[this.optaliases[a]] = opts[a];
            delete opts[a];
        }
    });

    Object.keys(opts).forEach((n) => {
        if (n === "_") return;

        if (!(n in this.optspec)) {
            throw Error("Unrecognised argument: " + n);
        }
    });

    if (this.argspec) {
        this.argspec.forEach((name) => {
            if (opts[name] !== undefined) return;
            if (!args.length) return;

            opts[name] = args.shift();
        });
    }

    var missing = [];
    Object.keys(this.optspec).sort().forEach((n) => {
        if (this.optspec[n].required && !(n in opts)) missing.push(n);
    });

    if (missing.length) {
        throw Error("Missing required arguments: " + missing.join(", "));
    }

    return this._func(main, opts, args, respond);
};

AdminCommand.makeHelpCommand = function(commands) {
    return new AdminCommand({
        desc: "display a list of commands",
        func: function(main, opts, args, respond) {
            if (args.length == 0) {
                Object.keys(commands).sort().forEach(function (k) {
                    var cmd = commands[k];
                    respond(k + ": " + cmd.desc);
                });
            }
            else {
                var name = args.shift();
                var cmd = commands[name];
                if (!cmd) {
                    throw Error("No such command '" + name + "'");
                }

                respond(name + " - " + cmd.desc);
                var argspec = cmd.argspec || [];
                if(argspec.length) {
                    respond("Arguments: " + argspec.map(
                            (n) => "[" + n.toUpperCase() + "]"
                        ).join(" "));
                }
                var optspec = cmd.optspec || {};
                Object.keys(optspec).sort().forEach((n) => {
                    respond("  --" + n + ": " + optspec[n].desc);
                });
            }
        },
    });
};

module.exports = AdminCommand;
