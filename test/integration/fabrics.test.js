/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Fabric tests
 */

var constants = require('../../lib/util/constants');
var errors = require('../../lib/util/errors');
var h = require('./helpers');
var mod_uuid = require('node-uuid');
var mod_vlan = require('../lib/vlan');
var test = require('tape');



// --- Globals



// XXX: shouldn't have to do this!
var NAPI = h.createNAPIclient();
var OWNERS = [
    mod_uuid.v4()
];
var VLANS = [
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[0],
        vlan_id: 42
    },
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[0],
        vlan_id: 43
    }
];



// --- Tests



test('create VLANs', function (t) {
    t.test('create: 0', function (t2) {
        mod_vlan.create(t2, {
            params: VLANS[0],
            exp: VLANS[0]
        });
    });


    t.test('get: 0', function (t2) {
        mod_vlan.get(t2, {
            params: {
                owner_uuid: VLANS[0].owner_uuid,
                vlan_id: VLANS[0].vlan_id
            },
            exp: VLANS[0]
        });
    });


    t.test('create: with same vlan', function (t2) {
        mod_vlan.create(t2, {
            params: {
                name: mod_vlan.randomName(),
                owner_uuid: VLANS[0].owner_uuid,
                vlan_id: VLANS[0].vlan_id
            },
            expErr: new errors.InUseError(constants.msg.VLAN_USED, [
                errors.duplicateParam('vlan_id', 'VLAN ID is already in use')
            ]).body
        });
    });


    t.test('create: 1', function (t2) {
        mod_vlan.create(t2, {
            params: VLANS[1],
            exp: VLANS[1]
        });
    });


    t.test('get: 1', function (t2) {
        mod_vlan.get(t2, {
            params: {
                owner_uuid: VLANS[1].owner_uuid,
                vlan_id: VLANS[1].vlan_id
            },
            exp: VLANS[1]
        });
    });
});


test('update VLANs', function (t) {
    t.test('update: 1', function (t2) {
        VLANS[1].name = VLANS[1].name + '-new';
        mod_vlan.update(t2, {
            params: VLANS[1],
            exp: VLANS[1]
        });
    });


    t.test('get: 1', function (t2) {
        mod_vlan.get(t2, {
            params: {
                owner_uuid: VLANS[1].owner_uuid,
                vlan_id: VLANS[1].vlan_id
            },
            exp: VLANS[1]
        });
    });
});


test('list VLANs', function (t) {
    mod_vlan.list(t, {
        params: {
            owner_uuid: OWNERS[0]
        },
        present: VLANS
    });
});


test('delete created VLANs', mod_vlan.delAllCreated);
