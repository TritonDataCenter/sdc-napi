/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for dealing with network pools
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Globals



var NUM = 0;



// --- Exports



/**
 * Create a network pool and compare the output
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    var name = opts.name;
    if (name === '<generate>') {
        name = util.format('test-pool%d-%d', NUM++, process.pid);
    }
    opts.reqType = 'create';
    opts.type = 'pool';
    opts.idKey = 'uuid';

    if (opts.exp && opts.name === '<generate>') {
        opts.exp.name = name;
    }

    client.createNetworkPool(name, clone(opts.params),
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
        if (opts.exp && !opts.params.uuid) {
            // We were assigned a UUID by NAPI, so add that to the
            // expected params
            opts.exp.uuid = res.uuid;
        }

        return get(t, opts, callback);
    });
}


/**
 * Delete a network pool
 */
function del(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    opts.type = 'pool';
    opts.id = opts.uuid;
    var params = opts.params || {};

    client.deleteNetworkPool(opts.uuid, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Delete all network pools
 */
function delAll(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');

    client.listNetworkPools(function (err, res) {
        if (common.ifErr(t, err, 'list network pools')) {
            return t.done();
        }

        if (res.length === 0) {
            return doneRes(res, t, callback);
        }

        var done = 0;

        function _afterDel() {
            done++;
            if (done === res.length) {
                doneRes(res, t, callback);
            }
        }

        for (var p in res) {
            var newOpts = clone(opts);
            newOpts.id = res[p].uuid;
            del(t, newOpts, _afterDel);
        }
    });
}


/**
 * Get a network pool and compare the output
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
    opts.type = 'pool';
    var params = {};

    if (opts.params) {
        params.params = opts.params;
    }

    client.getNetworkPool(opts.uuid, params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Returns the most recently created network pool
 */
function lastCreated() {
    return common.lastCreated('pools');
}


/**
 * List network pools
 */
function list(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';
    var params = opts.params || {};

    assert.object(t, 't');
    log.debug({ params: params }, 'list network pools');

    client.listNetworkPools(params, function (err, obj, _, res) {
        common.ifErr(t, err, 'list pools: ' + JSON.stringify(params) + desc);
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

    opts.type = 'pool';
    opts.reqType = 'update';
    client.updateNetworkPool(opts.uuid, opts.params,
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
    delAll: delAll,
    get: get,
    lastCreated: lastCreated,
    list: list,
    update: update,
    updateAndGet: updateAndGet
};
