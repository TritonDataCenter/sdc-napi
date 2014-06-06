/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with nics
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var verror = require('verror');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Internal



function addToState(opts, obj) {
    if (!opts.state || !obj) {
        return;
    }

    if (!opts.state.hasOwnProperty('nics')) {
        opts.state.nics = [];
    }

    var newObj = clone(obj);
    if (opts.hasOwnProperty('stateProp')) {
        if (!opts.state.hasOwnProperty(opts.stateProp)) {
            opts.state[opts.stateProp] = [];
        }

        opts.state[opts.stateProp].push(newObj);
    }

    opts.state.nics.push(newObj);
}



// --- Exports



/**
 * Create a nic and compare the output
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.mac, 'opts.mac');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    var mac = opts.mac;
    if (mac == 'generate') {
        mac = common.randomMAC();
    }

    var params = clone(opts.params);

    client.createNic(mac, params, function (err, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'create nic ' + opts.mac + desc)) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(res, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(res[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        addToState(opts, res);
        return doneRes(res, t, callback);
    });
}


/**
 * Create a nic, compare the output, then do the same for a get of
 * that nic.
 */
function createAndGet(t, opts, callback) {
    create(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return get(t, opts, callback);
    });
}


/**
 * Create num nics, and end the test when done
 */
function createN(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.number(opts.num, 'opts.num');
    assert.object(opts.params, 'opts.params');

    var done = 0;
    var errs = [];
    var nics = [];

    opts.mac = 'generate';

    // Don't require checking parameters
    if (!opts.exp && !opts.params.partialExp) {
        opts.partialExp = opts.params;
    }

    function _afterProvision(err, nic) {
        if (err) {
            errs.push(err);
        }

        if (nic) {
            nics.push(nic);
        }

        if (++done == opts.num) {
            if (errs.length !== 0) {
                return doneErr(new verror.MultiError(errs), t, callback);
            }

            return doneRes(nics, t, callback);
        }
    }

    for (var i = 0; i < opts.num; i++) {
        create(t, opts, _afterProvision);
    }
}


/**
 * Delete a nic
 */
function del(t, mac, callback) {
    var client = mod_client.get();

    if (typeof (mac) === 'object') {
        mac = mac.mac;
    }

    log.debug({ mac: mac }, 'delete nic');

    client.deleteNic(mac, function (err, obj, _, res) {
        common.ifErr(t, err, 'delete nic: ' + mac);
        t.equal(res.statusCode, 204, 'delete status code: ' + mac);

        return callback(err, obj);
    });
}


/**
 * Get a nic and compare the output
 */
function get(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.mac, 'opts.mac');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    client.getNic(opts.mac, function (err, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'get nic ' + opts.mac + desc)) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(res, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(res[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        return doneRes(res, t, callback);
    });
}


/**
 * Provision a nic and compare the output
 */
function provision(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.net, 'opts.net');
    assert.object(opts.params, 'opts.params');
    assert.optionalObject(opts.state, 'opts.state');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    log.debug({ params: opts.params }, 'provisioning nic');
    client.provisionNic(opts.net, opts.params, function (err, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'provisioning nic ' + desc)) {
            return doneErr(err, t, callback);
        }

        addToState(opts, res);

        if (opts.exp) {
            t.deepEqual(res, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(res[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        return doneRes(res, t, callback);
    });
}


/**
 * Update a nic and compare the output
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.mac, 'opts.mac');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    client.updateNic(opts.mac, opts.params, function (err, obj, _, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'update nic: ' + opts.mac + desc)) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(obj[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        t.equal(res.statusCode, 200, 'status code');

        return doneRes(obj, t, callback);
    });
}


/**
 * Update a nic, compare the output, then do the same for a get of
 * that nic.
 */
function updateAndGet(t, opts, callback) {
    update(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return get(t, opts, callback);
    });
}


module.exports = {
    create: create,
    createAndGet: createAndGet,
    createN: createN,
    del: del,
    get: get,
    provision: provision,
    update: update,
    updateAndGet: updateAndGet
};
