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

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var fmt = require('util').format;
var log = require('./log');
var mod_client = require('./client');
var mod_vasync = require('vasync');
var util_ip = require('../../lib/util/ip');

var doneErr = common.doneErr;


// --- Globals



var NIC_NET_PARAMS = [
    'gateway',
    'gateway_provisioned',
    'mtu',
    'netmask',
    'nic_tag',
    'resolvers',
    'routes',
    'vlan_id'
];
var NUM = 0;
var TYPE = 'network';



// --- Exports



/**
 * Add network parameters to a nic
 */
function addNetParams(net, nic) {
    NIC_NET_PARAMS.forEach(function (n) {
        if (net.hasOwnProperty(n) && !nic.hasOwnProperty(n)) {
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

    if (params.name === '<generate>') {
        params.name = netName();
    }

    opts.idKey = 'uuid';
    opts.fillIn = [ 'mtu' ];
    opts.reqType = 'create';
    opts.type = TYPE;

    if (opts.fillInMissing && opts.exp) {
        opts.exp.netmask = util_ip.bitsToNetmask(opts.exp.subnet.split('/')[1]);
        if (!opts.params.resolvers && !opts.exp.resolvers) {
            opts.exp.resolvers = [];
        }
    }

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

        if (!opts.params.uuid) {
            opts.params.uuid = res.uuid;
        }

        opts.params.uuid = res.uuid;
        return getNet(t, opts, callback);
    });
}


/**
 * Delete a network
 */
function delNet(t, opts, callback) {
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
 * Delete all the networks created by this test
 */
function delAllCreatedNets(t) {
    assert.object(t, 't');

    var created = common.allCreated('networks');
    if (created.length === 0) {
        t.ok(true, 'No networks created');
        return t.end();
    }

    mod_vasync.forEachParallel({
        inputs: created,
        func: function _delOne(net, cb) {
            var delOpts = {
                continueOnErr: true,
                exp: {},
                params: net,
                uuid: net.uuid
            };

            delNet(t, delOpts, cb);
        }
    }, function () {
        return t.end();
    });
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

    client.getNetwork(opts.params.uuid, params,
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
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalBool(opts.deepEqual, 'opts.deepEqual');
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

    client.listNetworks(params, common.reqOpts(t, opts.desc),
        common.afterAPIlist.bind(null, t, opts, callback));
}


/**
 * Generate a unique test network name
 */
function netName() {
    return fmt('test-net%d-%d', NUM++, process.pid);
}


/**
 * Update a network and compare the output
 */
function updateNet(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();

    opts.type = TYPE;
    opts.reqType = 'update';

    client.updateNetwork(opts.params.uuid, opts.params,
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
    del: delNet,
    delAllCreated: delAllCreatedNets,
    get: getNet,
    lastCreated: lastCreated,
    list: listNets,
    name: netName,
    netParams: NIC_NET_PARAMS,
    update: updateNet,
    updateAndGet: updateAndGet
};
