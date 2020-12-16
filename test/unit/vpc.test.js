/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * VPC unit tests
 *
 * This is largely similar in form to the fabric tests, though focused on
 * the differences between VPCs and fabrics.
 */

'use strict';

var config = require('../lib/config');
var h = require('./helpers');
var mod_uuid = require('node-uuid');
var mod_nic_tag = require('../lib/nic-tag');
var mod_portolan = require('../lib/portolan');
var mod_portolan_moray = require('portolan-moray');
var mod_server = require('../lib/server');
var test = require('tape');

// --- Globals



var MORAY;
var NAPI;
var UNDERLAY_NIC_TAG = config.server.overlay.underlayNicTag;
var moray_clone;

// --- Internals


// --- Setup


test('Initial VPC setup', function (t) {
    h.reset();

    t.test('create client and server', function (t2) {
        h.createClientAndServer({
            config: {
                initialNetworks: {
                    'admin': {
                        'vlan': 0,
                        'uuid': mod_uuid.v4(),
                        'network': '10.0.0.0',
                        'netmask': '255.255.255.0',
                        'owner_uuids': [ config.server.ufdsAdminUuid ],
                        'gateway': '10.0.0.1',
                        'startIP': '10.0.0.38',
                        'endIP': '10.0.0.253',
                        'resolvers': [ '8.8.8.8', '8.8.4.4' ]
                    }
                }
            }
        }, function (err, res, moray) {
            NAPI = res;
            MORAY = moray;
            t2.ifError(err, 'server creation');
            t2.ok(NAPI, 'client');
            t2.ok(MORAY, 'moray');
            t2.end();
        });
    });

    t.test('initialize portolan consumer', function (t2) {
        mod_portolan_moray.initConsumer({}, t2.end.bind(t2));
    });

    t.test('create nic tag', function (t2) {
        mod_nic_tag.create(t2, {
            name: 'nic_tag'
        });
    });

    t.test('create underlay nic tag', function (t2) {
        mod_nic_tag.create(t2, {
            name: UNDERLAY_NIC_TAG
        });
    });
});


test('Setup portolan moray client', function (t) {
    moray_clone = MORAY.clone();
    t.ok(moray_clone, 'Cloned Moray client');
    mod_portolan.moray_client = moray_clone;
    t.end();
});


// --- Tests

test('Create single VPC', function (t) {
    t.end();
});

test('Create two VPCs', function (t) {
    t.end();
});

test('Exceed VPC quota', function (t) {
    t.end();
});

test('Create VPC Network', function (t) {
    t.end();
});

test('Create VPC Network outside of CIDR block', function (t) {
    t.end();
});

// --- Teardown

test('Tear down moray client', function (t) {
    moray_clone.close();
    t.end();
});

test('Stop server', mod_server.close);
