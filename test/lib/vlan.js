/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for dealing with fabric VLANs
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var fmt = require('util').format;
var log = require('./log');
var mod_client = require('./client');
var mod_vasync = require('vasync');

var doneErr = common.doneErr;


// --- Globals



var NUM = 0;
var TYPE = 'vlan';



// --- Exports



/**
 * Create a VLAN
 */
function createVLAN(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();

    log.debug({ params: opts.params }, 'creating vlan');
    opts.fillIn = [ 'vnet_id' ];
    opts.type = TYPE;
    opts.reqType = 'create';

    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    delete params.owner_uuid;

    if (!opts.desc && opts.expErr) {
        opts.desc = JSON.stringify(opts.params);
    }

    client.createFabricVLAN(owner, params, common.reqOpts(t, opts.desc),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Create a fabric VLAN, compare the output, then do the same for a get of
 * that fabric VLAN.
 */
function createAndGetVLAN(t, opts, callback) {
    opts.reqType = 'create';
    createVLAN(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        opts.reqType = 'get';
        return getVLAN(t, opts, callback);
    });
}


/**
 * Delete a VLAN
 */
function delVLAN(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;

    opts.type = TYPE;
    opts.id = fmt('owner_uuid=%s, vlan_id=%d',
        params.owner_uuid, params.vlan_id);
    delete params.owner_uuid;
    delete params.vlan_uuid;

    log.debug({ opts: opts, owner: owner, vlan: vlan, params: params },
        'deleting VLAN');

    client.deleteFabricVLAN(owner, vlan, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Delete all the VLANs created by this test
 */
function delAllCreatedVLANs(t) {
    assert.object(t, 't');

    var created = common.allCreated('vlans');
    if (created.length === 0) {
        t.ok(true, 'No VLANs created');
        return t.end();
    }

    mod_vasync.forEachParallel({
        inputs: created,
        func: function _delOne(vlan, cb) {
            var delOpts = {
                continueOnErr: true,
                exp: {},
                params: vlan
            };

            delVLAN(t, delOpts, cb);
        }
    }, function () {
        return t.end();
    });
}


/**
 * Get a VLAN
 */
function getVLAN(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;

    log.debug({ params: opts.params }, 'getting vlan');
    opts.type = TYPE;
    opts.reqType = 'get';

    delete params.owner_uuid;
    delete params.vlan_id;

    client.getFabricVLAN(owner, vlan, params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * List VLANs
 */
function listVLANs(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var desc = ' ' + JSON.stringify(params)
        + (opts.desc ? (' ' + opts.desc) : '');

    if (!opts.desc) {
        opts.desc = desc;
    }

    opts.type = TYPE;
    opts.id = 'vlan_id';

    delete params.owner_uuid;

    log.debug({ params: params }, 'list vlans');

    client.listFabricVLANs(owner, params,
        common.afterAPIlist.bind(null, t, opts, callback));
}


/**
 * Generate a random VLAN name
 */
function randomVLANname() {
    return fmt('vlan-%d-%d', process.pid, NUM++);
}


/**
 * Update a VLAN
 */
function updateVLAN(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    var client = opts.client || mod_client.get();
    var owner = opts.params.owner_uuid;
    var params = clone(opts.params);
    var vlan = opts.params.vlan_id;

    delete params.owner_id;
    delete params.vlan_id;

    opts.type = TYPE;
    opts.reqType = 'update';
    client.updateFabricVLAN(owner, vlan, params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update a fabric VLAN, compare the output, then do the same for a get of
 * that fabric VLAN.
 */
function updateAndGetVLAN(t, opts, callback) {
    opts.reqType = 'update';
    updateVLAN(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        opts.reqType = 'get';
        return getVLAN(t, opts, callback);
    });
}



module.exports = {
    create: createVLAN,
    createAndGet: createAndGetVLAN,
    del: delVLAN,
    delAllCreated: delAllCreatedVLANs,
    get: getVLAN,
    list: listVLANs,
    randomName: randomVLANname,
    update: updateVLAN,
    updateAndGet: updateAndGetVLAN
};
