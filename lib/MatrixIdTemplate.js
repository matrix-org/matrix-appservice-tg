/*
Copyright 2017 Vector Creations Ltd
Copyright 2017, 2018 New Vector Ltd

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

"use strict";

function findFields(str) {
    var fields = [];

    // Scan the template looking for all the field names
    var re = /\${([^}]+)}/g;
    var result;
    while ((result = re.exec(str)) != null) {
        var field = result[1];

        if (fields.indexOf(field) !== -1) {
            throw new Error("Template field " + field + " appears multiple times");
        }
        fields.push(field);
    }

    return fields;
}

function escapeRegExp(string) {
    // https://developer.mozilla.org/en/docs/Web/JavaScript/Guide/Regular_Expressions
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Constructs a new MatrixIdTemplate that will parse and match ID strings of
 * the given template on the given homeserver domain
 * @constructor
 * @param {string} sigil The sigil character to prefix on full IDs. Usually "@"
 * for user IDs, or "#" for room aliases.
 * @param {string} str The localpart template string. This should contain
 * embedded variables in the form `${NAME}`.
 * @param {string} domain The homeserver domain name, for constructing or
 * matching full ID forms.
 */
function MatrixIdTemplate(sigil, str, domain) {
    this._sigil = sigil;
    this._str = str;
    this._domain = domain;
    this._fields = findFields(str);

    var re = str.replace(/\${[^}]+}/g, "(.*?)");

    this._localpartRe = new RegExp("^" + re + "$");
    this._idRe = new RegExp(
        "^" + escapeRegExp(sigil) + re + ":" + escapeRegExp(domain) + "$"
    );
}

/**
 * Returns true if the template uses a variable of the given name.
 * @return {Boolean}
 */
MatrixIdTemplate.prototype.hasField = function(name) {
    return this._fields.indexOf(name) !== -1;
};

function execRe(str, re, fields) {
    var result = re.exec(str);
    if (!result) return null;

    var values = {};
    for (var idx = 0; idx < fields.length; idx++) {
        values[fields[idx]] = result[idx+1];
    }

    return values;
}

/**
 * Attempts to match a localpart string, returning fields parsed from it, or
 * null if it does not match.
 * @param {string} str The localpart string to match.
 * @return {Object|null}
 */
MatrixIdTemplate.prototype.matchLocalpart = function(str) {
    return execRe(str, this._localpartRe, this._fields);
};

/**
 * Attempts to match a full ID string, returning fields parsed from it, or
 * null if it does not match.
 * @param {string} str The full ID string to match.
 * @return {Object|null}
 */
MatrixIdTemplate.prototype.matchId = function(str) {
    return execRe(str, this._idRe, this._fields);
};

/**
 * Returns a localpart string constructed by expanding the template with the
 * given fields.
 * @param {object} fields The values to expand into the template variables
 * @return {string}
 */
MatrixIdTemplate.prototype.expandLocalpart = function(fields) {
    var str = this._str;
    this._fields.forEach((n) => {
        if (!(n in fields)) {
            throw new Error("A value for " + n + " was not provided");
        }

        str = str.replace(new RegExp("\\${" + n + "}"), fields[n]);
    });
    return str;
};

/**
 * Returns a new full ID string constructed by expanding the template with the
 * given fields.
 * @param {object} fields The values to expand into the template variables
 * @return {string}
 */
MatrixIdTemplate.prototype.expandId = function(fields) {
    return this._sigil + this.expandLocalpart(fields) + ":" + this._domain;
};

module.exports = MatrixIdTemplate;
