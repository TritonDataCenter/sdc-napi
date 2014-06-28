/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with networks
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');
var verror = require('verror');

var doneRes = common.doneRes;
var doneErr = common.doneErr;


// --- Globals



var NUM = 0;



// --- Exports



/**
 * Create a network and compare the output
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    var params = clone(opts.params);
    if (params.name == '<generate>') {
        params.name = util.format('test-net%d-%d', NUM++, process.pid);
    }
    opts.reqType = 'create';
    opts.type = 'network';

    client.createNetwork(params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Create a nic, compare the output, then do the same for a get of
 * that nic.
 */
function createAndGet(t, opts, callback) {
    opts.reqType = 'create';
    create(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        opts.uuid = res.uuid;
        opts.reqType = 'get';
        return get(t, opts, callback);
    });
}


/**
 * Delete a network
 */
function del(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    opts.type = 'network';
    opts.id = opts.uuid;
    var params = opts.params || {};

    client.deleteNetwork(opts.uuid, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Get a network and compare the output
 */
function get(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    opts.reqType = 'get';
    opts.type = 'network';
    var params = opts.params || {};

    client.getNetwork(opts.uuid, params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Returns the most recently created network
 */
function lastCreated() {
    return common.lastCreated('networks');
}


/**
 * List networks
 */
function list(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var params = opts.params || {};
    var desc = ' ' + JSON.stringify(params)
        + (opts.desc ? (' ' + opts.desc) : '');

    log.debug({ params: params }, 'list networks');

    client.listNetworks(params, function (err, obj, _, res) {
        common.ifErr(t, err, 'list networks: ' + desc);
        if (err) {
            return doneErr(err, t, callback);
        }

        t.equal(res.statusCode, 200, 'status code' + desc);

        if (opts.present) {
            var left = clone(opts.present);
            var uuids = left.map(function (o) { return o.uuid; });

            for (var n in obj) {
                var resObj = obj[n];
                var idx = uuids.indexOf(resObj.uuid);
                if (idx !== -1) {
                    var expObj = left[idx];
                    var partialRes = {};
                    for (var p in expObj) {
                        partialRes[p] = resObj[p];
                    }

                    t.deepEqual(partialRes, expObj,
                        'partial result for ' + resObj.uuid + desc);

                    uuids.splice(idx, 1);
                    left.splice(idx, 1);
                }
            }

            t.deepEqual(uuids, [], 'all network UUIDs found' + desc);
        }

        return doneRes(obj, t, callback);
    });
}

/**
 * Update a nic and compare the output
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    opts.type = 'network';
    opts.reqType = 'update';
    client.updateNetwork(opts.uuid, opts.params,
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
    create: create,
    createAndGet: createAndGet,
    del: del,
    get: get,
    lastCreated: lastCreated,
    list: list,
    update: update,
    updateAndGet: updateAndGet
};
