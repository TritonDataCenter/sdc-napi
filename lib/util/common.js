/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Utilities: sharing is caring
 */

'use strict';

var errors = require('./errors');



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
function reqToOpts(req) {
    return { app: req.app, log: req.log, params: req.params };
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



module.exports = {
    arrayify: arrayify,
    repeat: repeat,
    requireParams: requireParams,
    reqToOpts: reqToOpts,
    translateParams: translateParams
};
