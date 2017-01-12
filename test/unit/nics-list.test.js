/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for searching for NICs
 */

'use strict';

var h = require('./helpers');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nicTag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var test = require('tape');


// --- Globals

var NIC_TAG1 = 'nic_tag1';
var NIC_TAG2 = 'nic_tag2';

var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];

var SERVERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];

var ZONES = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];

var NETS = [
    {
        name: 'nic-list-net0',
        vlan_id: 3,
        subnet: '10.2.1.0/24',
        gateway: '10.2.1.5',
        provision_start_ip: '10.2.1.6',
        provision_end_ip: '10.2.1.250',
        nic_tag: NIC_TAG1,
        resolvers: [ '8.8.8.8' ]
    },
    {
        name: 'nic-list-net1',
        vlan_id: 20,
        subnet: '10.50.0.0/16',
        gateway: '10.50.0.1',
        provision_start_ip: '10.50.0.50',
        provision_end_ip: '10.50.255.250',
        nic_tag: NIC_TAG2,
        resolvers: [ '8.8.4.4' ]
    }
];

var NICS = [ ];

var state = {
    nics: NICS
};


// -- Internal helpers

function splice(arr, idx, count) {
    var copy = arr.slice();
    copy.splice(idx, count);
    return copy;
}


// --- Setup

test('Initial setup', function (t) {
    h.reset();

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res, moray) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            t2.ok(moray, 'moray');
            t2.end();
        });
    });

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, {
            name: NIC_TAG1
        });
    });

    t.test('create nic_tag2', function (t2) {
        mod_nicTag.create(t2, {
            name: NIC_TAG2
        });
    });

    t.test('create NETS[0]', function (t2) {
        mod_net.create(t2, {
            params: NETS[0],
            partialExp: NETS[0]
        }, function (_, res) {
            NETS[0] = res;
            t2.end();
        });
    });

    t.test('create NETS[1]', function (t2) {
        mod_net.create(t2, {
            params: NETS[1],
            partialExp: NETS[1]
        }, function (_, res) {
            NETS[1] = res;
            t2.end();
        });
    });

    t.test('create NICS[0]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONES[0],
                allow_dhcp_spoofing: true,
                owner_uuid: OWNERS[0],
                cn_uuid: SERVERS[0],
                state: 'running'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[1]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONES[1],
                allow_ip_spoofing: true,
                owner_uuid: OWNERS[0],
                cn_uuid: SERVERS[0],
                state: 'stopped'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[2]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONES[2],
                allow_mac_spoofing: true,
                owner_uuid: OWNERS[1],
                cn_uuid: SERVERS[1],
                state: 'provisioning'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[3]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONES[3],
                allow_restricted_traffic: true,
                owner_uuid: OWNERS[1],
                cn_uuid: SERVERS[1],
                state: 'provisioning'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[4]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: ZONES[3],
                allow_unfiltered_promisc: true,
                owner_uuid: OWNERS[1],
                cn_uuid: SERVERS[1],
                state: 'stopped'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[5]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: OWNERS[1],
                underlay: true,
                state: 'provisioning'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[6]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: OWNERS[1],
                state: 'running'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[7]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[1],
                owner_uuid: OWNERS[1],
                state: 'provisioning'
            },
            state: state,
            partialExp: {}
        });
    });

    t.test('create NICS[8]', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'other',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid: OWNERS[0],
                state: 'running'
            },
            state: state,
            partialExp: {}
        });
    });
});


// --- Tests

test('Filter on "cn_uuid"', function (t) {
    var s1nics = [
        NICS[0],
        NICS[1]
    ];

    var s2nics = [
        NICS[2],
        NICS[3],
        NICS[4]
    ];

    t.test('List NICs on SERVERS[0]', function (t2) {
        mod_nic.list(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            deepEqual: true,
            present: s1nics
        });
    });

    t.test('List NICs on SERVERS[1]', function (t2) {
        mod_nic.list(t2, {
            params: {
                cn_uuid: SERVERS[1]
            },
            deepEqual: true,
            present: s2nics
        });
    });

    t.test('List NICs on all SERVERS', function (t2) {
        mod_nic.list(t2, {
            params: {
                cn_uuid: SERVERS
            },
            deepEqual: true,
            present: s1nics.concat(s2nics)
        });
    });
});

test('Filter on "network_uuid"', function (t) {
    t.test('Listing NICs on NETS[0]', function (t2) {
        mod_nic.list(t2, {
            params: {
                network_uuid: NETS[0].uuid
            },
            deepEqual: true,
            present: [
                NICS[0],
                NICS[1],
                NICS[5],
                NICS[8]
            ]
        });
    });

    t.test('Listing NICs on NETS[1]', function (t2) {
        mod_nic.list(t2, {
            params: {
                network_uuid: NETS[1].uuid
            },
            deepEqual: true,
            present: [
                NICS[2],
                NICS[3],
                NICS[4],
                NICS[6],
                NICS[7]
            ]
        });
    });
});

test('Filter on "underlay"', function (t) {
    t.test('underlay=true', function (t2) {
        mod_nic.list(t2, {
            params: {
                underlay: true
            },
            deepEqual: true,
            present: [ NICS[5] ]
        });
    });

    t.test('underlay=false', function (t2) {
        mod_nic.list(t2, {
            params: {
                underlay: 'false'
            },
            deepEqual: true,
            present: splice(NICS, 5, 1)
        });
    });
});

test('Filter on NIC spoofing properties', function (t) {
    function testSpoofFilter(prop, index) {
        var filter1 = {};
        var filter2 = {};

        filter1[prop] = true;
        filter2[prop] = false;

        var filter1res = [ NICS[index] ];
        var filter2res = splice(NICS, index, 1);

        t.test(prop + '=true', function (t2) {
            mod_nic.list(t2, {
                params: filter1,
                deepEqual: true,
                present: filter1res
            });
        });

        t.test(prop + '=false', function (t2) {
            mod_nic.list(t2, {
                params: filter2,
                deepEqual: true,
                present: filter2res
            });
        });
    }

    testSpoofFilter('allow_dhcp_spoofing', 0);
    testSpoofFilter('allow_ip_spoofing', 1);
    testSpoofFilter('allow_mac_spoofing', 2);
    testSpoofFilter('allow_restricted_traffic', 3);
    testSpoofFilter('allow_unfiltered_promisc', 4);
});


test('Filter on "owner_uuid"', function (t) {
    t.test('NICs that belong to OWNERS[0]', function (t2) {
        mod_nic.list(t2, {
            params: {
                owner_uuid: OWNERS[0]
            },
            deepEqual: true,
            present: [
                NICS[0],
                NICS[1],
                NICS[8]
            ]
        });
    });

    t.test('NICs that belong to OWNERS[1]', function (t2) {
        mod_nic.list(t2, {
            params: {
                owner_uuid: OWNERS[1]
            },
            deepEqual: true,
            present: [
                NICS[2],
                NICS[3],
                NICS[4],
                NICS[5],
                NICS[6],
                NICS[7]
            ]
        });
    });
});


test('Filter on "belongs_to_type"', function (t) {
    t.test('NICs that belong to "zone"', function (t2) {
        mod_nic.list(t2, {
            params: {
                belongs_to_type: 'zone'
            },
            deepEqual: true,
            present: [
                NICS[0],
                NICS[1],
                NICS[2],
                NICS[3],
                NICS[4]
            ]
        });
    });

    t.test('NICs that belong to "server"', function (t2) {
        mod_nic.list(t2, {
            params: {
                belongs_to_type: 'server'
            },
            deepEqual: true,
            present: [
                NICS[5],
                NICS[6],
                NICS[7]
            ]
        });
    });

    t.test('NICs that belong to "other"', function (t2) {
        mod_nic.list(t2, {
            params: {
                belongs_to_type: 'other'
            },
            deepEqual: true,
            present: [ NICS[8] ]
        });
    });
});


test('Filter on "state"', function (t) {
    t.test('NICs that are "running"', function (t2) {
        mod_nic.list(t2, {
            params: {
                state: 'running'
            },
            deepEqual: true,
            present: [
                NICS[0],
                NICS[6],
                NICS[8]
            ]
        });
    });

    t.test('NICs that are "provisioning"', function (t2) {
        mod_nic.list(t2, {
            params: {
                state: 'provisioning'
            },
            deepEqual: true,
            present: [
                NICS[2],
                NICS[3],
                NICS[5],
                NICS[7]
            ]
        });
    });

    t.test('NICs that are "stopped"', function (t2) {
        mod_nic.list(t2, {
            params: {
                state: 'stopped'
            },
            deepEqual: true,
            present: [ NICS[1], NICS[4] ]
        });
    });
});


test('Filter on "belongs_to_uuid"', function (t) {
    t.test('NICs belonging to SERVERS[0]', function (t2) {
        mod_nic.list(t2, {
            params: {
                belongs_to_uuid: SERVERS[0]
            },
            deepEqual: true,
            present: [ NICS[5], NICS[6] ]
        });
    });

    t.test('NICS on ZONES[0] and ZONES[1]', function (t2) {
        mod_nic.list(t2, {
            params: {
                belongs_to_uuid: [ ZONES[0], ZONES[1] ]
            },
            deepEqual: true,
            present: [ NICS[0], NICS[1] ]
        });
    });
});


test('Filter on NIC_TAG1', function (t) {
    mod_nic.list(t, {
        params: {
            nic_tag: NIC_TAG1
        },
        deepEqual: true,
        exp: [
            NICS[0],
            NICS[1],
            NICS[5],
            NICS[8]
        ]
    });
});


// --- Shutdown

test('delete nics', mod_nic.delAllCreated);

test('Stop server', mod_server.close);
