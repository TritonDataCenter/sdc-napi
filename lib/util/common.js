/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Utilities: sharing is caring
 */

'use strict';

var errors = require('./errors');
var mod_jsprim = require('jsprim');
var restify = require('restify');
var VError = require('verror');

// --- Globals

var IF_MATCH_FAIL = 'if-match \'%s\' didn\'t match etag \'%s\'';


// --- Exports

/**
 * Turn a value into an array, unless it is one already.
 */
function arrayify(obj) {
    if (typeof (obj) === 'object') {
        return obj;
    }

    if (obj === '') {
        return [];
    }

    return obj.split(',');
}


/**
 * Keeps repeating repeatCb, calling afterCb once done.
 * the arguments to repeatCb are: fn(err, res, keepGoing)
 * Every time repeatCb calls cb with keepGoing === true,
 * repeatCb will be called again.
 */
function repeat(repeatCb, afterCb) {
    var next;

    next = function (err, res, keepGoing) {
        if (!keepGoing) {
            return afterCb(err, res);
        }

        return setImmediate(function _repeat() { repeatCb(next); });
    };

    return setImmediate(function _repeatFirst() { repeatCb(next); });
}


/**
 * Extracts necessary params from a restify request object for passing to
 * model functions
 */
function reqToOpts(req, extra) {
    var conditional = (
        req.headers['if-match'] !== undefined ||
        req.headers['if-none-match'] !== undefined);

    return mod_jsprim.mergeObjects({
        app: req.app,
        log: req.log,
        params: req.params,
        isConditionalRequest: conditional
    }, extra);
}


/**
 * Returns an array of error elements for each parameter name in requiredParams
 * that is not present in params
 *
 * @param requiredParams {Array}: list of required params
 * @param params {Object}: hash of actual params
 */
function requireParams(requiredParams, params) {
    var missing = [];
    requiredParams.forEach(function (param) {
        if (!params.hasOwnProperty(param)) {
            missing.push(errors.missingParam(param));
        }
    });

    return missing;
}

/**
 * Translates parameters in from -> to (modifying to), using map as a guide
 */
function translateParams(from, map, to) {
    for (var p in map) {
        if (from.hasOwnProperty(p)) {
            to[map[p]] = from[p];
        }
    }
}


function getEtag(etags, bucket, key) {
    for (var i = 0; i < etags.length; ++i) {
        if (etags[i].bucket === bucket && etags[i].key === key) {
            return etags[i].etag;
        }
    }

    return null;
}


function translateEtagError(err) {
    var ece = VError.findCauseByName(err, 'EtagConflictError');
    if (ece !== null) {
        return new restify.errors.PreconditionFailedError(IF_MATCH_FAIL,
            ece.context.expected, ece.context.actual);
    }

    return err;
}


module.exports = {
    arrayify: arrayify,
    getEtag: getEtag,
    repeat: repeat,
    requireParams: requireParams,
    reqToOpts: reqToOpts,
    translateEtagError: translateEtagError,
    translateParams: translateParams
};
