/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Fabric unit tests
 *
 * This file is really just a wrapper around the fabric integration tests,
 * and takes care of setting up the unit testing environment for them.
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


// --- Internals


function runFabricTest(file) {
    var desc = '"' + file + '"';
    var moray_clone;

    test('Set up for ' + desc, function (t) {
        moray_clone = MORAY.clone();
        t.ok(moray_clone, 'Cloned Moray client');
        mod_portolan.moray_client = moray_clone;
        t.end();
    });

    require('../integration/' + file);

    test('Tear down for ' + desc, function (t) {
        moray_clone.close();
        t.end();
    });
}



// --- Setup


test('Initial setup', function (t) {
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



// --- Tests


runFabricTest('fabrics.test.js');
runFabricTest('fabrics-invalid.test.js');



// --- Teardown


test('Stop server', mod_server.close);
