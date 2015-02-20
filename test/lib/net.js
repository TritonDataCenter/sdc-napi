/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for dealing with networks
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');

var doneRes = common.doneRes;
var doneErr = common.doneErr;


// --- Globals



var NIC_NET_PARAMS = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers',
    'routes'];
var NUM = 0;
var TYPE = 'network';



// --- Exports



/**
 * Add network parameters to a nic
 */
function addNetParams(net, nic) {
    NIC_NET_PARAMS.forEach(function (n) {
        if (net.hasOwnProperty(n)) {
            nic[n] = net[n];
        }
    });

    nic.network_uuid = net.uuid;
    return nic;
}


/**
 * Create a network and compare the output
 */
function createNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();
    var params = clone(opts.params);

    if (params.name == '<generate>') {
        params.name = util.format('test-net%d-%d', NUM++, process.pid);
    }
    opts.reqType = 'create';
    opts.type = TYPE;

    client.createNetwork(params, common.reqOpts(t, opts.desc),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Create a network, compare the output, then do the same for a get of
 * that network.
 */
function createAndGet(t, opts, callback) {
    opts.reqType = 'create';
    createNet(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        opts.uuid = res.uuid;
        return getNet(t, opts, callback);
    });
}


/**
 * Delete a network
 */
function del(t, opts, callback) {
    assert.object(t, 't');
    assert.string(opts.uuid, 'opts.uuid');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    var client = opts.client || mod_client.get();
    var params = opts.params || {};

    opts.type = TYPE;
    opts.id = opts.uuid;

    client.deleteNetwork(opts.uuid, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Get a network and compare the output
 */
function getNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();
    var params = opts.params || {};

    opts.reqType = 'get';
    opts.type = TYPE;

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
function listNets(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var params = opts.params || {};
    var desc = ' ' + JSON.stringify(params)
        + (opts.desc ? (' ' + opts.desc) : '');

    if (!opts.desc) {
        opts.desc = desc;
    }
    opts.id = 'uuid';
    opts.type = TYPE;

    log.debug({ params: params }, 'list networks');

    client.listNetworks(params,
        common.afterAPIlist.bind(null, t, opts, callback));
}


/**
 * Update a network and compare the output
 */
function updateNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();

    opts.type = TYPE;
    opts.reqType = 'update';

    client.updateNetwork(opts.uuid, opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update a network, compare the output, then do the same for a get of
 * that network.
 */
function updateAndGet(t, opts, callback) {
    updateNet(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return getNet(t, opts, callback);
    });
}



module.exports = {
    addNetParams: addNetParams,
    create: createNet,
    createAndGet: createAndGet,
    del: del,
    get: getNet,
    lastCreated: lastCreated,
    list: listNets,
    netParams: NIC_NET_PARAMS,
    update: updateNet,
    updateAndGet: updateAndGet
};
