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

var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var mod_fabric_net = require('../lib/fabric-net');
var mod_nic = require('../lib/nic');
var mod_net = require('../lib/net');
var mod_vlan = require('../lib/vlan');
var test = require('tape');



// --- Globals



var CREATED = {};
// XXX: shouldn't have to do this!
var NAPI = h.createNAPIclient();
var OWNERS = [
    mod_uuid.v4(),
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
    },

    // Different owner, same VLAN
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[1],
        vlan_id: 43
    }
];
var NETS = [

    // -- On VLANS[0] (OWNERS[0])

    // 0
    {
        vlan_id: VLANS[0].vlan_id,
        subnet: '10.2.1.0/24',
        gateway: '10.2.1.5',
        name: mod_fabric_net.generateName(),
        owner_uuid: VLANS[0].owner_uuid,
        provision_start_ip: '10.2.1.5',
        provision_end_ip: '10.2.1.250',
        resolvers: ['8.8.8.8'],
        routes: {
            '10.3.1.0/24': '10.2.1.1'
        }
    },
    // 1
    {
        vlan_id: VLANS[0].vlan_id,
        subnet: '10.2.2.0/23',
        gateway: '10.2.3.254',
        name: mod_fabric_net.generateName(),
        owner_uuid: VLANS[0].owner_uuid,
        provision_start_ip: '10.2.2.5',
        provision_end_ip: '10.2.3.250'
    },

    // -- On VLANS[1] (OWNERS[0])

    // 2
    {
        vlan_id: VLANS[1].vlan_id,
        subnet: '192.168.0.0/24',
        name: mod_fabric_net.generateName(),
        owner_uuid: VLANS[1].owner_uuid,
        provision_start_ip: '192.168.0.2',
        provision_end_ip: '192.168.0.254'
    },

    // -- On VLANS[2] (OWNERS[1])

    // 3
    {
        vlan_id: VLANS[2].vlan_id,
        subnet: '192.168.0.0/24',
        name: mod_fabric_net.generateName('overlap'),
        owner_uuid: VLANS[2].owner_uuid,
        provision_start_ip: '192.168.0.2',
        provision_end_ip: '192.168.0.254'
    }

];
var VMS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];



// --- Tests



test('create VLANs', function (t) {

    t.test('create vlan: 0', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: VLANS[0],
            exp: VLANS[0]
        });
    });


    t.test('create vlan: same owner, same vlan', function (t2) {
        mod_vlan.create(t2, {
            params: {
                name: mod_vlan.randomName(),
                owner_uuid: VLANS[0].owner_uuid,
                vlan_id: VLANS[0].vlan_id
            },
            expErr: mod_err.vlanInUse()
        });
    });


    t.test('create vlan: 1', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: VLANS[1],
            exp: VLANS[1]
        });
    });


    t.test('create vlan: 2', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: VLANS[2],
            exp: VLANS[2]
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
    t.test('OWNERS[0]', function (t2) {
        mod_vlan.list(t2, {
            params: {
                owner_uuid: OWNERS[0]
            },
            present: [ VLANS[0], VLANS[1] ]
        });
    });


    t.test('OWNERS[1]', function (t2) {
        mod_vlan.list(t2, {
            params: {
                owner_uuid: OWNERS[1]
            },
            present: [ VLANS[2] ]
        });
    });
});


test('create network', function (t) {
    t.test('create network: 0', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: NETS[0],
            exp: NETS[0]
        });
    });


    t.test('create network: 1', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: NETS[1],
            exp: NETS[1]
        });
    });


    t.test('create network: 2', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: NETS[2],
            exp: NETS[2]
        });
    });


    t.test('create network: overlapping', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: NETS[2],
            expErr: mod_err.subnetOverlap(NETS[2])
        });
    });


    t.test('create network: 3', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: NETS[3],
            exp: NETS[3]
        });
    });
});


//
// XXX: add me later
//  test('update networks', function (t) {
//      t.test('resize subnet', function (t2) {
//          mod_fabric_net.update(t2, {
//              fillInMissing: true,
//              params: {
//                  uuid: NETS[3].uuid,
//                  vlan_id: NETS[3].vlan_id,
//                  owner_uuid: NETS[3].owner_uuid,
//                  provision_start_ip: '192.168.0.1',
//                  provision_end_ip: '192.168.0.250'
//              },
//              exp: NETS[3]
//          });
//      });
//  });
//


test('list networks', function (t) {
    t.test('VLANS[0]', function (t2) {
        mod_fabric_net.list(t2, {
            params: {
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[0].vlan_id
            },
            present: [ NETS[0], NETS[1] ]
        });
    });

    t.test('VLANS[1]', function (t2) {
        mod_fabric_net.list(t2, {
            params: {
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[1].vlan_id
            },
            present: [ NETS[2] ]
        });
    });
});


test('provision nics', function (t) {
    t.test('NETS[0]: provision', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            // XXX: make this part of params
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                owner_uuid: OWNERS[0]
            }),
            state: CREATED    // store this nic in CREATED.nics
        });
    });


    t.test('NETS[0]: provision with IP', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                ip: '10.2.1.40',
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                ip: '10.2.1.40',
                owner_uuid: OWNERS[0]
            }),
            state: CREATED    // store this nic in CREATED.nics
        });
    });

    // Pick IP not in subnet

});


// Create networks
// - Can't create public (non-RFC1918) nets
// - Can create same subnet with multiple owners
// - Can't create overlapping subnet with same owner
// - Invalid routes
// - Try to create networks that are larger than the RFC1918 space
//   - or resize around them
// - check that the first 4 addresses are reserved
// - and the last one

// - Make sure we can't use body params to override vlan_id or owner

// Update tests:
// - Can't update owner_uuids or vlan_id


// - Can't set another owner UUID on a fabric network

// List networks
// - Check that you can see them in /networks
// - Only owner_uuid

// Delete tests:
// - Don't allow deleting a network if it has nics on it
// - Don't allow deleting a VLAN if it has networks on it


// Ownership tests:
// - Don't allow deleting someone else's network
// - Listing
// - Updating
// - Getting

// Try to create over 1k (the limit) for:
// - vlans
// - networks


//
// XXX
//  test('delete vlan with networks on it', function (t) {
//      mod_vlan.del(t, {
//          params: {
//
//          },
//          expErr: {
//
//          }
//
//      });
//  });
//


test('delete created networks', mod_fabric_net.delAllCreated);

test('delete created VLANs', mod_vlan.delAllCreated);
