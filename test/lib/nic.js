/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
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



// --- Exports



/**
 * Create a nic and compare the output
 */
function createNic(t, opts, callback) {
    var client = opts.client || mod_client.get();

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
    opts.type = 'nic';
    opts.reqType = 'create';

    client.createNic(mac, clone(opts.params),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Create a nic, compare the output, then do the same for a get of
 * that nic.
 */
function createAndGetNic(t, opts, callback) {
    createNic(t, opts, function (err, res) {
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
        createNic(t, opts, _afterProvision);
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

    assert.object(t, 't');
    assert.string(opts.mac, 'opts.mac');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    opts.type = 'nic';
    opts.reqType = 'get';
    client.getNic(opts.mac, common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Provision a nic and compare the output
 */
function provisionNic(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();
    log.debug({ params: opts.params }, 'provisioning nic');
    opts.type = 'nic';
    opts.reqType = 'create';

    if (opts.exp && opts.fillInMissing) {
        opts.fillIn = [ 'ip', 'mac', 'primary', 'state' ];
    }

    client.provisionNic(opts.net, opts.params, common.reqOpts(t),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update a nic and compare the output
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.mac, 'opts.mac');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    opts.type = 'nic';
    opts.reqType = 'update';

    client.updateNic(opts.mac, opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
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
    create: createNic,
    createAndGet: createAndGetNic,
    createN: createN,
    del: del,
    get: get,
    provision: provisionNic,
    update: update,
    updateAndGet: updateAndGet
};
