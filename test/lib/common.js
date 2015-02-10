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

var assert = require('assert-plus');
var clone = require('clone');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var NAPI = require('sdc-clients').NAPI;
var util = require('util');



// --- Exported functions



var CREATED = {};



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

        return done(err, null, opts, t, callback);
    }

    if (ifErr(t, err, type + desc)) {
        return done(err, null, opts, t, callback);
    }

    t.equal(res.statusCode, 200, 'status code' + desc);

    if (opts.exp) {
        if (opts.hasOwnProperty('idKey') &&
            !opts.exp.hasOwnProperty(opts.idKey)) {
            opts.exp[opts.idKey] = obj[opts.idKey];
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

    if (opts.reqType == 'create') {
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

    if (opts.present) {
        var left = clone(opts.present);
        var ids = left.map(function (o) { return o[id]; });

        for (var n in obj) {
            var resObj = obj[n];
            var idx = ids.indexOf(resObj[id]);
            if (idx !== -1) {
                var expObj = left[idx];
                var partialRes = {};
                for (var p in expObj) {
                    partialRes[p] = resObj[p];
                }

                t.deepEqual(partialRes, expObj,
                    'partial result for ' + resObj[id] + desc);

                ids.splice(idx, 1);
                left.splice(idx, 1);
            }
        }

        t.deepEqual(ids, [], 'found all ' + type + 's ' + desc);
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
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
        'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');
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
        message: mod_err.msg.invalidParam
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
         if (oct.length == 1) {
                oct = '0' + oct;
         }
         data.push(oct);
    }

    return data.join(':');
}





module.exports = {
    addToState: addToState,
    afterAPIcall: afterAPIcall,
    afterAPIdelete: afterAPIdelete,
    afterAPIlist: afterAPIlist,
    allCreated: allCreated,
    assertArgs: assertArgs,
    createClient: createClient,
    doneErr: doneErr,
    doneRes: doneRes,
    ifErr: ifErr,
    invalidParamErr: invalidParamErr,
    lastCreated: lastCreated,
    missingParamErr: missingParamErr,
    randomMAC: randomMAC
};
