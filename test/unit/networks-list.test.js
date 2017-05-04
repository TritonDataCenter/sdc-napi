/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for listing networks.
 */

'use strict';

var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var mod_nic_tag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var test = require('tape');


// --- Globals

var TAG_A;
var TAG_B;
var NETS = [];


// --- Setup

test('Initial setup', function (t) {
    h.reset();

    t.test('Start server', function (t2) {
        h.createClientAndServer(function (err, res, moray) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            t2.ok(moray, 'moray');
            t2.end();
        });
    });

    t.test('Create TAG_A', function (t2) {
        // Match the name of the nic tag in h.validNetworkParams()
        mod_nic_tag.create(t2, {
            name: 'nic_tag',
            partialExp: {
                name: 'nic_tag'
            }
        }, function (_, res) {
            TAG_A = res;
            t2.end();
        });
    });

    t.test('Create TAG_B', function (t2) {
        mod_nic_tag.create(t2, {
            name: 'nic_tag_b',
            partialExp: {
                name: 'nic_tag_b'
            }
        }, function (_, res) {
            TAG_B = res;
            t2.end();
        });
    });
});


test('Create networks', function (t) {
    t.test('Create NETS[0]', function (t2) {
        mod_net.create(t2, {
            params: h.validNetworkParams({
                vlan_id: 20
            }),
            partialExp: {
                vlan_id: 20,
                family: 'ipv4'
            }
        }, function (_, res) {
            NETS.push(res);
            t2.end();
        });
    });

    t.test('Create NETS[1]', function (t2) {
        mod_net.create(t2, {
            params: h.validNetworkParams({
                nic_tag: TAG_B.name
            }),
            partialExp: {
                nic_tag: TAG_B.name,
                family: 'ipv4'
            }
        }, function (_, res) {
            NETS.push(res);
            t2.end();
        });
    });

    t.test('Create NETS[2]', function (t2) {
        mod_net.create(t2, {
            params: h.validNetworkParams(),
            partialExp: {
                family: 'ipv4'
            }
        }, function (_, res) {
            NETS.push(res);
            t2.end();
        });
    });

    t.test('Create NETS[3]', function (t2) {
        mod_net.create(t2, {
            params: h.validIPv6NetworkParams({
                nic_tag: TAG_B.name
            }),
            partialExp: {
                nic_tag: TAG_B.name,
                family: 'ipv6'
            }
        }, function (_, res) {
            NETS.push(res);
            t2.end();
        });
    });
});


// --- Tests


test('List IPv4 networks', function (t) {
    mod_net.list(t, {
        params: {
            family: 'ipv4'
        },
        deepEqual: true,
        present: [
            NETS[0],
            NETS[1],
            NETS[2]
        ]
    });
});


test('List IPv6 networks', function (t) {
    mod_net.list(t, {
        params: {
            family: 'ipv6'
        },
        deepEqual: true,
        present: [
            NETS[3]
        ]
    });
});


test('List with bad family', function (t) {
    mod_net.list(t, {
        params: {
            family: 'ipv2'
        },
        expErr: h.invalidParamErr({
            errors: [
                mod_err.invalidParam('family', 'must be one of: "ipv4", "ipv6"')
            ]
        })
    });
});


test('List networks on TAG_A', function (t) {
    mod_net.list(t, {
        params: {
            nic_tag: TAG_A.name
        },
        deepEqual: true,
        present: [
            NETS[0],
            NETS[2]
        ]
    });
});


test('List networks on TAG_B', function (t) {
    mod_net.list(t, {
        params: {
            nic_tag: TAG_B.name
        },
        deepEqual: true,
        present: [
            NETS[1],
            NETS[3]
        ]
    });
});


test('List networks on VLAN 20', function (t) {
    mod_net.list(t, {
        params: {
            vlan_id: 20
        },
        deepEqual: true,
        present: [
            NETS[0]
        ]
    });
});




// --- Teardown

test('Stop server', mod_server.close);
