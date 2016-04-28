/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Common test helpers shared between integration and unit tests
 */

'use strict';

var assert = require('assert-plus');
var fmt = require('util').format;
var clone = require('clone');
var constants = require('../../lib/util/constants');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var NAPI = require('sdc-clients').NAPI;
var util = require('util');


var CREATED = {};

// --- Exported variables


/**
 * This is a set of common errors that can be used for the expErr function for
 * limit, offset, and friends.
 */
var commonErrors = {
    ce_limit: {
        code: 'InvalidParameters',
        message: 'Invalid parameters',
        errors: [ {
            code: 'InvalidParameter',
            field: 'limit',
            message: 'invalid limit, must be an integer greater than 0 or ' +
                'less than or equal to 1000'
        } ]
    },
    ce_offset: {
        code: 'InvalidParameters',
        message: 'Invalid parameters',
        errors: [ {
            code: 'InvalidParameter',
            field: 'offset',
            message: 'invalid value, offset must be an integer greater than ' +
                'or equal to 0'
        } ]
    }, ce_unknown: {
        code: 'InvalidParameters',
        message: 'Invalid parameters',
        errors: [ {
            code: 'UnknownParameters',
            field: [ 'terra' ],
            message: 'Unknown parameters: terra'
        } ]
    }, ce_dunknown: {
        code: 'InvalidParameters',
        message: 'Invalid parameters',
        errors: [ {
            code: 'UnknownParameters',
            field: [ 'terra', 'elbereth' ],
            message: 'Unknown parameters: terra, elbereth'
        } ]
    }
};

var badLimitOffTests = [
    {
        bc_name: 'bad limit (I)',
        bc_params: { limit: -5 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (II)',
        bc_params: { limit: 0 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (III)',
        bc_params: { limit: 'asdf' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (IV)',
        bc_params: { limit: 9001 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (V)',
        bc_params: { limit: { foo: 'bar' } },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (VI)',
        bc_params: { limit: 3.456 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (VII)',
        bc_params: { limit: '304 asdf' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (VIII)',
        bc_params: { limit: undefined },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad limit (IX)',
        bc_params: { limit: null },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_limit
    },
    {
        bc_name: 'bad offset (I)',
        bc_params: { offset: -5 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (II)',
        bc_params: { offset: 'asdf' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (III)',
        bc_params: { offset: { foo: 'bar' } },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (IV)',
        bc_params: { offset: 5.678 },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (V)',
        bc_params: { offset: '69 seconds left' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (VI)',
        bc_params: { offset: undefined },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'bad offset (VII)',
        bc_params: { offset: null },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_offset
    },
    {
        bc_name: 'unknown param (I)',
        bc_params: { 'terra': 'incognita' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_unknown
    },
    {
        bc_name: 'unknown param (II)',
        bc_params: { 'terra': 'incognita', 'elbereth': 'gilothoniel' },
        bc_expcode: 422,
        bc_experr: commonErrors.ce_dunknown
    }
];



// --- Exported functions



/**
 * Adds the given object to:
 * - CREATED[type]
 * - opts.state (if opts and opts.state are present)
 */
function addToState(opts, type, obj) {
    if (!CREATED.hasOwnProperty(type)) {
        CREATED[type] = [];
    }

    CREATED[type].push(obj);

    if (!opts.state || !obj) {
        return;
    }

    if (!opts.state.hasOwnProperty(type)) {
        opts.state[type] = [];
    }

    var newObj = clone(obj);
    if (opts.hasOwnProperty('stateProp')) {
        if (!opts.state.hasOwnProperty(opts.stateProp)) {
            opts.state[opts.stateProp] = [];
        }

        opts.state[opts.stateProp].push(newObj);
    }

    opts.state[type].push(newObj);
}


/**
 * Shared test code for after API methods are called
 */
function afterAPIcall(t, opts, callback, err, obj, _, res) {
    var desc = opts.desc ? (' ' + opts.desc) : '';
    assert.string(opts.reqType, 'opts.reqType');
    assert.string(opts.type, 'opts.type');
    var type = opts.reqType + ' ' + opts.type + ': ';

    if (opts.expErr) {
        t.ok(err, type + 'expected error' + desc);
        if (err) {
            var code = opts.expCode || 422;
            t.equal(err.statusCode, code, type + 'status code' + desc);
            t.deepEqual(err.body, opts.expErr, type + 'error body' + desc);
        }

        if (obj) {
            t.deepEqual(obj, {}, 'body (error expected)' + desc);
        }

        return done(err, null, opts, t, callback);
    }

    if (ifErr(t, err, type + desc)) {
        return done(err, null, opts, t, callback);
    }

    t.equal(res.statusCode, 200, 'status code' + desc);

    if (opts.hasOwnProperty('idKey')) {
        t.ok(true, fmt('created %s "%s"', opts.type, obj[opts.idKey]));
    }

    if (opts.exp) {
        // For creates, the server will generate an ID (usually a UUID) if
        // it's not set in the request.  Copy this over to the expected
        // object so that we don't have to set it manually:
        if (opts.hasOwnProperty('idKey') &&
                !opts.exp.hasOwnProperty(opts.idKey)) {
            opts.exp[opts.idKey] = obj[opts.idKey];
        }

        // Allow filling in values that might be generated before doing the
        // deepEqual below:
        if (opts.hasOwnProperty('fillIn')) {
            opts.fillIn.forEach(function (prop) {
                if (!opts.exp.hasOwnProperty(prop) &&
                    obj.hasOwnProperty(prop)) {
                    opts.exp[prop] = obj[prop];
                }
            });
        }

        t.deepEqual(obj, opts.exp, type + 'full result' + desc);
    }

    if (opts.partialExp) {
        var partialRes = {};
        for (var p in opts.partialExp) {
            partialRes[p] = obj[p];
        }

        t.deepEqual(partialRes, opts.partialExp,
            type + 'partial result' + desc);
    }

    if (opts.reqType === 'create') {
        addToState(opts, opts.type + 's', obj);
    }

    return done(null, obj, opts, t, callback);
}


/**
 * Shared test code for after API delete methods are called
 */
function afterAPIdelete(t, opts, callback, err, obj, req, res) {
    var desc = opts.desc ? (' ' + opts.desc) : '';
    assert.string(opts.type, 'opts.type');
    assert.string(opts.id, 'opts.id');
    var type = util.format('delete %s %s: ', opts.type, opts.id);

    if (opts.expErr) {
        t.ok(err, 'expected error');
        if (err) {
            var code = opts.expCode || 422;
            t.equal(err.statusCode, code, 'status code');
            t.deepEqual(err.body, opts.expErr, 'error body');
        }

        return done(err, null, opts, t, callback);
    }

    // mightNotExist allows for calling mod_whatever.dellAllCreated() when
    // some of the created objects were actually deleted during the test:
    if (opts.mightNotExist && err && err.restCode === 'ResourceNotFound') {
        return done(null, obj, opts, t, callback);
    }

    if (ifErr(t, err, type + desc)) {
        return done(err, null, opts, t, callback);
    }

    t.equal(res.statusCode, 204, type + 'status code' + desc);

    return done(null, obj, opts, t, callback);
}


/**
 * Shared test code for after API list methods are called
 */
function afterAPIlist(t, opts, callback, err, obj, _, res) {
    assert.string(opts.type, 'opts.type');
    assert.string(opts.id, 'opts.id');

    var desc = opts.desc ? (' ' + opts.desc) : '';
    var id = opts.id;
    var type = opts.type;

    if (opts.expErr) {
        t.ok(err, type + 'expected error' + desc);
        if (err) {
            var code = opts.expCode || 422;
            t.equal(err.statusCode, code, type + 'status code' + desc);
            t.deepEqual(err.body, opts.expErr, type + 'error body' + desc);
        }

        return done(err, null, opts, t, callback);
    }

    if (ifErr(t, err, type + desc)) {
        return done(err, null, opts, t, callback);
    }

    t.equal(res.statusCode, 200, 'status code' + desc);
    t.ok(true, obj.length + ' results returned' + desc);

    if (opts.present) {
        var left = clone(opts.present);
        var ids = left.map(function (o) { return o[id]; });
        var present = clone(ids);
        var notInPresent = [];

        for (var n in obj) {
            var resObj = obj[n];
            var idx = ids.indexOf(resObj[id]);
            if (idx !== -1) {
                var expObj = left[idx];
                var partialRes = {};
                for (var p in expObj) {
                    partialRes[p] = resObj[p];
                }

                if (opts.deepEqual) {
                    t.deepEqual(resObj, expObj,
                        'full result for ' + resObj[id] + desc);

                } else {
                    t.deepEqual(partialRes, expObj,
                        'partial result for ' + resObj[id] + desc);
                }

                ids.splice(idx, 1);
                left.splice(idx, 1);
            } else {
                notInPresent.push(resObj);
            }
        }

        t.deepEqual(ids, [],
            'found ' + type + 's not specified in opts.present ' + desc);

        if (ids.length !== 0) {
            t.deepEqual(present, [], 'IDs in present list');
        }

        if (opts.deepEqual) {
            t.deepEqual(notInPresent, [], 'IDs not in present list');
        }
    }

    return done(null, obj, opts, t, callback);
}


/**
 * Gets all of the created objects of the given type
 */
function allCreated(type) {
    return CREATED[type] || [];
}


/**
 * Assert the arguments to one of the helper functions are correct
 */
function assertArgs(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
        'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');
    assert.optionalObject(opts.state, 'opts.state');
    assert.optionalFunc(callback, 'callback');
}


/**
 * Creates a NAPI client for the configured NAPI instance, with a unique
 * req_id.
 */
function createClient(url, t) {
    var reqID = mod_uuid.v4();
    var opts = {
        agent: false,
        headers: { 'x-request-id': reqID },
        url: url
    };

    var client = new NAPI(opts);
    client.req_id = reqID;

    if (t) {
        t.ok(client, 'created client with req_id=' + client.req_id);
    }

    return client;
}


/**
 * Finish a test
 */
function done(err, res, opts, t, callback) {
    if (callback) {
        return callback(opts.continueOnErr ? null : err, res);
    }

    return t.end();
}


/**
 * Finish a test with an error
 */
function doneErr(err, t, callback) {
    if (callback) {
        return callback(err);
    }

    return t.end();
}


/**
 * Finish a test with a result
 */
function doneRes(res, t, callback) {
    if (callback) {
        return callback(null, res);
    }

    return t.end();
}


/**
 * Calls t.ifError, outputs the error body for diagnostic purposes, and
 * returns true if there was an error
 */
function ifErr(t, err, desc) {
    t.ifError(err, desc);
    if (err) {
        t.deepEqual(err.body, {}, desc + ': error body');
        return true;
    }

    return false;
}


/**
 * Returns an invalid parameter error body, overriding with fields in
 * extra
 */
function invalidParamErr(extra) {
    assert.optionalObject(extra, 'extra');

    var newErr = {
        code: 'InvalidParameters',
        message: constants.msg.INVALID_PARAMS
    };

    for (var e in extra) {
        newErr[e] = extra[e];
    }

    return newErr;
}


/**
 * Gets the last created object of the given type (eg: nics, networks)
 */
function lastCreated(type) {
    if (!CREATED.hasOwnProperty(type) || CREATED[type].length === 0) {
        return null;
    }

    return CREATED[type][CREATED[type].length - 1];
}


/**
 * Returns an missing parameter error body, overriding with fields in
 * extra
 */
function missingParamErr(extra) {
    assert.optionalObject(extra, 'extra');

    var newErr = {
        code: 'InvalidParameters',
        message: mod_err.msg.missingParams
    };

    for (var e in extra) {
        newErr[e] = extra[e];
    }

    return newErr;
}


/**
 * Generate a valid random MAC address (multicast bit not set, locally
 * administered bit set)
 */
function randomMAC() {
    var data = [(Math.floor(Math.random() * 15) + 1).toString(16) + 2];
    for (var i = 0; i < 5; i++) {
         var oct = (Math.floor(Math.random() * 255)).toString(16);
         if (oct.length === 1) {
                oct = '0' + oct;
         }
         data.push(oct);
    }

    return data.join(':');
}


/**
 * Generate request opts
 */
function requestOpts(t, desc) {
    var reqId = mod_uuid.v4();
    t.ok(reqId, fmt('req ID: %s%s', reqId, (desc ? ': ' + desc : '')));

    return { headers: { 'x-request-id': reqId } };
}


/**
 * Sort by uuid property
 */
function uuidSort(a, b) {
    return (a.uuid > b.uuid) ? 1 : -1;
}



module.exports = {
    addToState: addToState,
    afterAPIcall: afterAPIcall,
    afterAPIdelete: afterAPIdelete,
    afterAPIlist: afterAPIlist,
    allCreated: allCreated,
    assertArgs: assertArgs,
    badLimitOffTests: badLimitOffTests,
    commonErrors: commonErrors,
    createClient: createClient,
    doneErr: doneErr,
    doneRes: doneRes,
    ifErr: ifErr,
    invalidParamErr: invalidParamErr,
    lastCreated: lastCreated,
    missingParamErr: missingParamErr,
    randomMAC: randomMAC,
    reqOpts: requestOpts,
    uuidSort: uuidSort
};
