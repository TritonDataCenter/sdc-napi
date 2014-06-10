/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Common test helpers shared between integration and unit tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var NAPI = require('sdc-clients').NAPI;



// --- Exported functions



/**
 * Adds the given object to opts.state (if opts and opts.state are present)
 */
function addToState(opts, type, obj) {
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
function afterAPIcall(t, opts, callback, err, res) {
    var desc = opts.desc ? (' ' + opts.desc) : '';
    assert.string(opts.reqType, 'opts.reqType');
    assert.string(opts.type, 'opts.type');
    var type = opts.reqType + ' ' + opts.type + ': ';

    if (opts.expErr) {
        t.ok(err, 'expected error');
        if (err) {
            var code = opts.expCode || 422;
            t.equal(err.statusCode, code, 'status code');
            t.deepEqual(err.body, opts.expErr, 'error body');
        }

        return doneErr(err, t, callback);
    }

    if (ifErr(t, err, type + opts.mac + desc)) {
        return doneErr(err, t, callback);
    }

    if (opts.exp) {
        t.deepEqual(res, opts.exp, type + 'full result' + desc);
    }

    if (opts.partialExp) {
        var partialRes = {};
        for (var p in opts.partialExp) {
            partialRes[p] = res[p];
        }

        t.deepEqual(partialRes, opts.partialExp,
            type + 'partial result' + desc);
    }

    if (opts.reqType == 'create') {
        addToState(opts, opts.type + 's', res);
        // XXX
        // t.equal(res.statusCode, 200, 'status code');
    }

    return doneRes(res, t, callback);
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
 * Finish a test with an error
 */
function doneErr(err, t, callback) {
    if (callback) {
        return callback(err);
    }

    return t.done();
}


/**
 * Finish a test with a result
 */
function doneRes(res, t, callback) {
    if (callback) {
        return callback(null, res);
    }

    return t.done();
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
    createClient: createClient,
    doneErr: doneErr,
    doneRes: doneRes,
    ifErr: ifErr,
    invalidParamErr: invalidParamErr,
    missingParamErr: missingParamErr,
    randomMAC: randomMAC
};
