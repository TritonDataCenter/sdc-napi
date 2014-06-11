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
var verror = require('verror');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Exports



/**
 * Create a network and compare the output
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    var mac = opts.mac;
    if (mac == 'generate') {
        mac = common.randomMAC();
    }
    opts.reqType = 'create';
    opts.type = 'network';

    client.createNetwork(clone(opts.params),
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
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';
    var params = opts.params || {};

    assert.object(t, 't');
    log.debug({ params: params }, 'list networks');

    client.listNetworks(params, function (err, obj, _, res) {
        common.ifErr(t, err, 'list networks: ' + JSON.stringify(params) + desc);
        t.equal(res.statusCode, 200,
            'status code: ' + JSON.stringify(params) + desc);

        return callback(err, obj);
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
    get: get,
    lastCreated: lastCreated,
    list: list,
    update: update,
    updateAndGet: updateAndGet
};
