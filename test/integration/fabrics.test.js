/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Fabric tests
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var config = require('../lib/config');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var mod_fabric_net = require('../lib/fabric-net');
var mod_jsprim = require('jsprim');
var mod_nic = require('../lib/nic');
var mod_nic_tag = require('../lib/nic-tag');
var mod_net = require('../lib/net');
var mod_portolan = require('../lib/portolan');
var mod_vlan = require('../lib/vlan');
var test = require('../lib/fabrics').testIfEnabled;

var extend = mod_jsprim.mergeObjects;



// --- Globals



var ADMIN_OWNER;    // Loaded in setup below
var CREATED = {};
var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];
var OVERLAY_MTU = config.server.overlay.defaultOverlayMTU;
var OVERLAY_NIC_TAG = config.server.overlay.overlayNicTag;
var UNDERLAY_MTU = config.server.overlay.defaultUnderlayMTU;
var UNDERLAY_NIC_TAG = config.server.overlay.underlayNicTag;
var VLANS = [
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[0],
        vlan_id: 42
    },
    {
        name: mod_vlan.randomName(),
        description: 'vlan 1',
        owner_uuid: OWNERS[0],
        vlan_id: 43
    },

    // Different owner, same VLAN
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[1],
        vlan_id: 43
    },

    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[2],
        vlan_id: 44
    }
];
// Real (non-fabric networks):
var REAL_NETS = [
    h.validNetworkParams({ nic_tag: UNDERLAY_NIC_TAG }),

    // Create a real network for the owner to make sure that we don't
    // mistakenly list it when listing fabric networks
    h.validNetworkParams({
        owner_uuids: [ OWNERS[1] ],
        vlan_id: VLANS[1].vlan_id
    })
];

// Fabric networks:
var NETS = [

    // -- On VLANS[0] (OWNERS[0])

    // 0
    {
        vlan_id: VLANS[0].vlan_id,
        subnet: '10.2.1.0/24',
        gateway: '10.2.1.5',
        internet_nat: true,
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
        internet_nat: true,
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
        internet_nat: false,
        name: mod_fabric_net.generateName(),
        owner_uuid: VLANS[1].owner_uuid,
        provision_start_ip: '192.168.0.2',
        provision_end_ip: '192.168.0.254'
    },

    // -- On VLANS[2] (OWNERS[1])

    // 3: same subnet range and VLAN as 2, but different owner
    {
        vlan_id: VLANS[2].vlan_id,
        subnet: '192.168.0.0/24',
        internet_nat: false,
        name: mod_fabric_net.generateName('overlap'),
        owner_uuid: VLANS[2].owner_uuid,
        provision_start_ip: '192.168.0.2',
        provision_end_ip: '192.168.0.254'
    },

    // -- On VLANS[3] (OWNERS[2])

    // 4: intended for ensuring the "fields" property works
    {
        vlan_id: VLANS[3].vlan_id,
        subnet: '172.16.0.0/22',
        // Also double-check that the MTU is correct:
        mtu: OVERLAY_MTU,
        internet_nat: false,
        name: mod_fabric_net.generateName('fields'),
        owner_uuid: VLANS[3].owner_uuid,
        provision_start_ip: '172.16.1.1',
        provision_end_ip: '172.16.3.254'
    }

];
var VMS = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];
var SERVERS = [
    mod_uuid.v4(),
    mod_uuid.v4(),

    // Nothing goes on SERVERS[2], so its event log is always empty
    mod_uuid.v4()
];
var SERVER_NICS = [];


// --- Internal helper functions


function checkEventLog(t, opts) {
    assert.object(t);
    assert.object(opts);

    t.test('Shootdowns generated for SERVERS[0]', function (t2) {
        mod_portolan.logReq(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            exp: opts.log1
        });
    });

    t.test('Shootdowns generated for SERVERS[1]', function (t2) {
        mod_portolan.logReq(t2, {
            params: {
                cn_uuid: SERVERS[1]
            },
            exp: opts.log2
        });
    });

    t.test('Shootdowns generated for SERVERS[2]', function (t2) {
        mod_portolan.logReq(t2, {
            params: {
                cn_uuid: SERVERS[2]
            },
            exp: opts.log3
        });
    });
}


// XXX: make test() here something that checks if overlays are enabled,
// and if not, fails and ends the test


// --- Setup



test('setup', function (t) {

    t.test('load UFDS admin UUID', function (t2) {
        h.loadUFDSadminUUID(t2, function (adminUUID) {
            if (adminUUID) {
                ADMIN_OWNER = adminUUID;
            }

            return t2.end();
        });
    });

    t.test('create default nic tag', mod_nic_tag.createDefault);

});



// --- Tests



test('overlay / underlay nic tags', function (t) {

    t.test('overlay tag', function (t2) {
        mod_nic_tag.get(t2, {
            params: {
                name: OVERLAY_NIC_TAG
            },
            partialExp: {
                mtu: UNDERLAY_MTU,
                name: OVERLAY_NIC_TAG
            }
        });
    });


    t.test('underlay tag', function (t2) {
        mod_nic_tag.get(t2, {
            params: {
                name: UNDERLAY_NIC_TAG
            },
            partialExp: {
                mtu: UNDERLAY_MTU,
                name: UNDERLAY_NIC_TAG
            }
        });
    });

});


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


    t.test('create vlan: 3', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: extend(VLANS[3], {
                // Specify at least owner_uuid and vlan_id - these are required
                // by mod_vlan.delAllCreated() in the test teardown.
                fields: [ 'name', 'owner_uuid', 'vlan_id' ]
            }),
            exp: {
                name: VLANS[3].name,
                owner_uuid: VLANS[3].owner_uuid,
                vlan_id: VLANS[3].vlan_id
            }
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


    t.test('update: 3', function (t2) {
        var updateParams = {
            description: 'new description',
            fields: [ 'name', 'description', 'vlan_id' ],
            owner_uuid: VLANS[3].owner_uuid,
            vlan_id: VLANS[3].vlan_id
        };

        VLANS[3].description = updateParams.description;

        mod_vlan.updateAndGet(t2, {
            params: updateParams,
            exp: {
                description: updateParams.description,
                name: VLANS[3].name,
                vlan_id: updateParams.vlan_id
            }
        });
    });

});


test('list VLANs', function (t) {

    t.test('OWNERS[0]', function (t2) {
        mod_vlan.list(t2, {
            deepEqual: true,
            params: {
                owner_uuid: OWNERS[0]
            },
            present: [ VLANS[0], VLANS[1] ]
        });
    });


    t.test('OWNERS[1]', function (t2) {
        mod_vlan.list(t2, {
            deepEqual: true,
            params: {
                owner_uuid: OWNERS[1]
            },
            present: [ VLANS[2] ]
        });
    });


    t.test('OWNERS[2]: list with fields', function (t2) {
        mod_vlan.list(t2, {
            deepEqual: true,
            params: {
                fields: [ 'name', 'vlan_id' ],
                owner_uuid: OWNERS[2]
            },
            present: [ VLANS[3] ].map(function (v) {
                return {
                    name: v.name,
                    vlan_id: v.vlan_id
                };
            })
        });
    });

});


test('create network', function (t) {

    t.test('create network: 0', function (t2) {
        // Make sure we don't require mtu to be set:
        var params = clone(NETS[0]);
        delete params.mtu;

        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: params,
            exp: NETS[0]
        });
    });


    t.test('get full network: 0', function (t2) {
        mod_net.get(t2, {
            params: {
                uuid: NETS[0].uuid
            },
            exp: mod_fabric_net.toRealNetObj(NETS[0])
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


    t.test('gateway_provisioned set', function (t2) {
        t2.equal(NETS[0].gateway_provisioned, false,
            'NETS[0]: gateway_provisioned unset');
        t2.equal(NETS[1].gateway_provisioned, false,
            'NETS[1]: gateway_provisioned unset');
        t2.equal(NETS[2].gateway_provisioned, undefined,
            'NETS[1]: no gateway_provisioned property');
        t2.equal(NETS[3].gateway_provisioned, undefined,
            'NETS[2]: no gateway_provisioned property');

        return t2.end();
    });

    t.test('vnet_ids match', function (t2) {
        // VLANs with the same owner_uuid share the same vnet_id
        t.ok(VLANS[0].vnet_id, 'VLANS[0] has vnet_id');
        t.ok(VLANS[1].vnet_id, 'VLANS[0] has vnet_id');
        t.equal(VLANS[0].vnet_id, VLANS[1].vnet_id,
            'OWNERS[0] vlans: vnet_ids match');
        t.ok(VLANS[0].vnet_id !== VLANS[2].vnet_id,
            'different owner vlans: vnet_ids do not match');

        // The vnet_ids for the networks must match the ids of their
        // parent VLANs

        t.equal(NETS[0].vnet_id, VLANS[0].vnet_id, 'NETS[0] vnet_id');
        t.equal(NETS[1].vnet_id, VLANS[0].vnet_id, 'NETS[1] vnet_id');

        t.equal(NETS[2].vnet_id, VLANS[1].vnet_id, 'NETS[2] vnet_id');
        t.equal(NETS[3].vnet_id, VLANS[2].vnet_id, 'NETS[3] vnet_id');

        return t2.end();
    });


    t.test('create network: 4', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            params: extend(NETS[4], {
                // mod_fabric_net.delAllCreated() needs uuid, owner_uuid and
                // vlan_id in order to delete the network:
                fields: [ 'name', 'owner_uuid', 'subnet', 'uuid', 'vlan_id' ]
            }),
            exp: {
                name: NETS[4].name,
                owner_uuid: NETS[4].owner_uuid,
                subnet: NETS[4].subnet,
                // uuid gets filled in by createAndGet()
                vlan_id: NETS[4].vlan_id
            }
        });
    });


    // Get net 4 to make sure fields weren't saved to moray
    t.test('get network: 4', function (t2) {
        var newNet4 = extend(mod_fabric_net.lastCreated(), {
            fabric: true,
            internet_nat: false,
            mtu: OVERLAY_MTU,
            netmask: '255.255.252.0',
            nic_tag: OVERLAY_NIC_TAG,
            provision_start_ip: NETS[4].provision_start_ip,
            provision_end_ip: NETS[4].provision_end_ip,
            resolvers: []
        });

        mod_fabric_net.get(t2, {
            fillIn: [ 'vnet_id' ],
            params: newNet4,
            exp: newNet4
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

    t.test('create real network', function (t2) {
        mod_net.create(t2, {
            fillInMissing: true,
            params: REAL_NETS[1],
            exp: REAL_NETS[1]
        });
    });


    t.test('VLANS[0]', function (t2) {
        mod_fabric_net.list(t2, {
            params: {
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[0].vlan_id
            },
            deepEqual: true,
            present: [ NETS[0], NETS[1] ]
        });
    });


    t.test('VLANS[1]', function (t2) {
        mod_fabric_net.list(t2, {
            params: {
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[1].vlan_id
            },
            deepEqual: true,
            present: [ NETS[2] ]
        });
    });


    t.test('VLANS[2]', function (t2) {
        mod_fabric_net.list(t2, {
            params: {
                owner_uuid: VLANS[2].owner_uuid,
                vlan_id: VLANS[2].vlan_id
            },
            deepEqual: true,
            present: [ NETS[3] ]
        });
    });


    t.test('list all networks: OWNERS[1]', function (t2) {
        mod_net.list(t2, {
            params: {
                owner_uuid: OWNERS[1]
            },
            deepEqual: true,
            present: [ REAL_NETS[1], mod_fabric_net.toRealNetObj(NETS[3]) ]
        });
    });


    t.test('list all networks: OWNERS[1], fabric=true', function (t2) {
        mod_net.list(t2, {
            params: {
                owner_uuid: OWNERS[1],
                fabric: true
            },
            deepEqual: true,
            present: [ mod_fabric_net.toRealNetObj(NETS[3]) ]
        });
    });

});


/*
 * Test that we can create the same network (particularly with the same name)
 * for different users, and for both real and fabric networks.
 *
 * Note that this test is after the list test above so that we don't have to
 * much about adding more networks to NETS
 */
test('identical networks, different users', function (t) {

    var identical = {
        subnet: '192.168.1.0/24',
        name: mod_fabric_net.generateName(),
        provision_start_ip: '192.168.1.2',
        provision_end_ip: '192.168.1.254'
    };
    var identicalNets = [
        extend(identical, {
            owner_uuid: OWNERS[0],
            vlan_id: VLANS[1].vlan_id
        }),
        extend(identical, {
            owner_uuid: OWNERS[1],
            vlan_id: VLANS[2].vlan_id
        }),

        // A "real" (non-fabric) network:
        h.validNetworkParams(identical)
    ];


    t.test('create identical network: 0', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: identicalNets[0],
            exp: identicalNets[0]
        });
    });


    t.test('create identical network: 1', function (t2) {
        mod_fabric_net.createAndGet(t2, {
            fillInMissing: true,
            params: identicalNets[1],
            exp: identicalNets[1]
        });
    });


    t.test('create real identical network', function (t2) {
        mod_net.create(t2, {
            fillInMissing: true,
            params: identicalNets[2],
            exp: identicalNets[2]
        });
    });


    t.test('list identical networks: no owner', function (t2) {
        mod_net.list(t2, {
            params: {
                name: identical.name
            },
            deepEqual: true,
            present: [ identicalNets[2] ]
        });
    });


    t.test('list identical networks: OWNERS[0]', function (t2) {
        mod_net.list(t2, {
            params: {
                name: identical.name,
                provisionable_by: OWNERS[0]
            },
            deepEqual: true,
            present: [
                mod_fabric_net.toRealNetObj(identicalNets[0]),
                identicalNets[2]
            ]
        });
    });


    t.test('list identical fabric networks: OWNERS[0]', function (t2) {
        mod_net.list(t2, {
            params: {
                fabric: true,
                name: identical.name,
                provisionable_by: OWNERS[0]
            },
            deepEqual: true,
            present: [
                mod_fabric_net.toRealNetObj(identicalNets[0])
            ]
        });
    });


    t.test('list identical networks: OWNERS[1]', function (t2) {
        mod_net.list(t2, {
            params: {
                name: identical.name,
                provisionable_by: OWNERS[1]
            },
            deepEqual: true,
            present: [
                mod_fabric_net.toRealNetObj(identicalNets[1]),
                identicalNets[2]
            ]
        });
    });


    t.test('list identical fabric networks: OWNERS[1]', function (t2) {
        mod_net.list(t2, {
            params: {
                fabric: true,
                name: identical.name,
                provisionable_by: OWNERS[1]
            },
            deepEqual: true,
            present: [
                mod_fabric_net.toRealNetObj(identicalNets[1])
            ]
        });
    });


    t.test('list identical fabric networks: no owner specified', function (t2) {
        mod_net.list(t2, {
            params: {
                fabric: true,
                name: identical.name
            },
            deepEqual: true,
            present: [
                mod_fabric_net.toRealNetObj(identicalNets[0]),
                mod_fabric_net.toRealNetObj(identicalNets[1])
            ]
        });
    });


    t.test('list identical fabric networks: non-existent name', function (t2) {
        mod_net.list(t2, {
            params: {
                fabric: true,
                name: mod_fabric_net.generateName('doesnotexist')
            },
            deepEqual: true,
            present: []
        });
    });


    t.test('create second network with same name', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                vlan_id: VLANS[1].vlan_id,
                subnet: '192.168.2.0/24',
                name: identical.name,
                owner_uuid: OWNERS[0],
                provision_start_ip: '192.168.2.2',
                provision_end_ip: '192.168.2.254'
            },
            expErr: mod_err.netNameInUse()
        });
    });

});


/*
 * Provision underlay vnics for servers
 */
test('provision server nics', function (t) {

    t.test('create real network', function (t2) {
        mod_net.create(t2, {
            fillInMissing: true,
            params: REAL_NETS[0],
            exp: REAL_NETS[0]
        });
    });


    t.test('REAL_NETS[0]: provision non-underlay nic', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: REAL_NETS[0].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: ADMIN_OWNER
            },
            exp: mod_net.addNetParams(REAL_NETS[0], {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: ADMIN_OWNER
            })
        });
    });


    t.test('non-underlay nic: underlay mapping not created', function (t2) {
        SERVER_NICS.push(mod_nic.lastCreated());
        t.ok(SERVER_NICS[0], 'have last created nic');

        mod_portolan.underlayMapping(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            expErr: mod_portolan.notFoundErr()
        });
    });

    t.test('REAL_NETS[0]: fail to provision underlay NIC', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: REAL_NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: ADMIN_OWNER,
                underlay: true
            },
            expErr: mod_err.invalidParam('underlay',
                constants.SERVER_UNDERLAY_MSG)
        });
    });

    t.test('REAL_NETS[0]: provision SERVERS[0] underlay NIC', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: REAL_NETS[0].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: ADMIN_OWNER,
                underlay: true
            },
            exp: mod_net.addNetParams(REAL_NETS[0], {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: ADMIN_OWNER,
                underlay: true
            })
        });
    });

    t.test('underlay mapping created', function (t2) {
        SERVER_NICS.push(mod_nic.lastCreated());
        t.ok(SERVER_NICS[1], 'have last created nic');
        t.ok(SERVER_NICS[1].underlay, 'nic has underlay property');

        mod_portolan.underlayMapping(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            exp: {
                cn_uuid: SERVERS[0],
                ip: SERVER_NICS[1].ip,
                port: constants.VXLAN_PORT
            }
        });
    });

    t.test('REAL_NETS[0]: provision SERVERS[1] underlay NIC', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: REAL_NETS[0].uuid,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[1],
                owner_uuid: ADMIN_OWNER,
                underlay: true
            },
            exp: mod_net.addNetParams(REAL_NETS[0], {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[1],
                owner_uuid: ADMIN_OWNER,
                underlay: true
            })
        });
    });

    t.test('underlay mapping created', function (t2) {
        SERVER_NICS.push(mod_nic.lastCreated());
        t.ok(SERVER_NICS[2], 'have last created nic');
        t.ok(SERVER_NICS[2].underlay, 'nic has underlay property');

        mod_portolan.underlayMapping(t2, {
            params: {
                cn_uuid: SERVERS[1]
            },
            exp: {
                cn_uuid: SERVERS[1],
                ip: SERVER_NICS[2].ip,
                port: constants.VXLAN_PORT
            }
        });
    });

    // XXX: disallow provisioning fabric networks on the underlay nic tag!

});


test('provision zone nics', function (t) {

    var nicTags = [
        mod_fabric_net.nicTag(t, NETS[0]),
        mod_fabric_net.nicTag(t, NETS[3])
    ];

    t.test('NETS[0]: provision', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            // XXX: make this part of params
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                fabric: true,
                internet_nat: true,
                nic_tag: nicTags[0],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[0]
            })
        });
    });

    var updateNic;

    // This test should fail, since no cn_uuid was provided
    t.test('NETS[0]: provision without cn_uuid', function (t2) {
        updateNic = mod_nic.lastCreated();
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                owner_uuid: OWNERS[0]
            },
            expErr: mod_err.missingParam('cn_uuid')
        });
    });

    t.test('NETS[0]: provision with IP', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                cn_uuid: SERVERS[0],
                ip: '10.2.1.40',
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                cn_uuid: SERVERS[0],
                fabric: true,
                ip: '10.2.1.40',
                internet_nat: true,
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            })
        });
    });


    t.test('NETS[1]: provision', function (t2) {
        CREATED.net0nic = mod_nic.lastCreated();
        t.ok(CREATED.net0nic, 'last created nic');

        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[1],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[1], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[1],
                fabric: true,
                internet_nat: true,
                cn_uuid: SERVERS[0],
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            })
        });
    });


    // We specified cn_uuid when provisioning the last nic, so it should
    // have an overlay mapping
    t.test('nic 2: overlay mapping added', function (t2) {
        CREATED.updateNic = mod_nic.lastCreated();
        t.ok(CREATED.updateNic, 'last created nic');

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: CREATED.updateNic
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: CREATED.updateNic.ip,
                mac: CREATED.updateNic.mac,
                version: 1,
                vnet_id: mod_portolan.nicVnetID(t, CREATED.updateNic)
            }
        });
    });


    t.test('NETS[3]: provision', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[3].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[1]
            },
            exp: mod_net.addNetParams(NETS[3], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                fabric: true,
                internet_nat: false,
                nic_tag: nicTags[1],
                owner_uuid: OWNERS[1]
            })
        });
    });

    t.test('nic 3: overlay mapping added', function (t2) {
        var nic = mod_nic.lastCreated();
        t.ok(nic, 'last created nic');

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: nic.ip,
                mac: nic.mac,
                version: 1,
                vnet_id: mod_portolan.nicVnetID(t, nic)
            }
        });
    });

    t.test('update nic to change cn_uuid', function (t2) {
        mod_nic.updateAndGet(t2, {
            mac: updateNic.mac,
            params: {
                cn_uuid: SERVERS[1]
            },
            partialExp: {
                cn_uuid: SERVERS[1]
            }
        });
    });

    t.test('update nic to change underlay', function (t2) {
        mod_nic.update(t2, {
            mac: updateNic.mac,
            params: {
                underlay: true
            },
            expErr: mod_err.invalidParam('underlay',
                constants.SERVER_UNDERLAY_MSG)
        });
    });

    t.test('update nic: overlay mapping changed', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: updateNic
            },
            exp: {
                cn_uuid: SERVERS[1],
                deleted: false,
                ip: updateNic.ip,
                mac: updateNic.mac,
                version: 1,
                vnet_id: mod_portolan.nicVnetID(t, updateNic)
            }
        });
    });


    t.test('delete nic', function (t2) {
        mod_nic.del(t2, {
            mac: updateNic.mac,
            exp: {}
        });
    });


    t.test('deleted nic: overlay mapping updated', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: updateNic
            },
            expErr: mod_portolan.notFoundErr()
        });
    });

    // XXX: provision with different owner and make sure it errors
});


test('update nics', function (t) {

    // We should be able to PUT the same params back to a nic and get the
    // same object back
    t.test('update nic with same params', function (t2) {
        mod_nic.updateAndGet(t2, {
            mac: CREATED.updateNic.mac,
            params: CREATED.updateNic,
            exp: CREATED.updateNic,
            ignore: [ 'modified_timestamp' ]
        });
    });


    t.test('update nic: invalid vnet ID', function (t2) {
        var params = clone(CREATED.updateNic);
        params.nic_tag = params.nic_tag.replace(/\/\d+$/, '/asdf');

        mod_nic.update(t2, {
            mac: CREATED.updateNic.mac,
            params: params,
            expErr: mod_err.invalidParam('nic_tag', constants.msg.VNET)
        });
    });


    t.test('update nic: invalid vnet ID', function (t2) {
        var params = clone(CREATED.updateNic);
        /* JSSTYLED */
        params.nic_tag = params.nic_tag.replace(/^[^/]+\//, 'doesnotexist/');

        mod_nic.update(t2, {
            mac: CREATED.updateNic.mac,
            params: params,
            expErr: mod_err.invalidParam('nic_tag', 'nic tag does not exist')
        });
    });
});

test('basic shootdown tests', function (t) {
    var nic1, nic2;
    var vnet_id, vlan_id;
    var nic_tag = mod_fabric_net.nicTag(t, NETS[0]);
    var newIP = NETS[1].provision_end_ip;

    // NIC <n>, Virtual Layer <n>, shootdown <n>
    var nic1vl3s1;
    var nic1vl3s2;
    var nic1vl2s1;
    var nic2vl3s1;

    t.test('clear event log for SERVERS[0]', function (t2) {
        mod_portolan.logReq(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            partialExp: {}
        });
    });

    t.test('clear event log for SERVERS[1]', function (t2) {
        mod_portolan.logReq(t2, {
            params: {
                cn_uuid: SERVERS[1]
            },
            partialExp: {}
        });
    });

    t.test('provision nic1', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[3],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[1], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[3],
                cn_uuid: SERVERS[0],
                fabric: true,
                nic_tag: nic_tag,
                owner_uuid: OWNERS[0]
            })
        });
    });

    t.test('overlay mapping updated', function (t2) {
        nic1 = mod_nic.lastCreated();
        t.ok(nic1, 'last created nic');

        vnet_id = mod_portolan.nicVnetID(t, nic1);
        vlan_id = nic1.vlan_id;

        nic1vl3s1 = {
            vnet_id: vnet_id,
            version: 1,
            record: {
                type: 'SVP_LOG_VL3',
                ip: nic1.ip,
                mac: nic1.mac,
                vlan: vlan_id,
                vnet_id: vnet_id
            }
        };

        nic1vl2s1 = {
            vnet_id: vnet_id,
            version: 1,
            record: {
                type: 'SVP_LOG_VL2',
                mac: nic1.mac,
                vnet_id: vnet_id
            }
        };

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic1
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: nic1.ip,
                mac: nic1.mac,
                version: 1,
                vnet_id: vnet_id
            }
        });
    });

    t.test('Checking VL3 shootdowns', function (t2) {
        checkEventLog(t2, {
            log1: [ extend(nic1vl3s1, { cn_uuid: SERVERS[0] }) ],
            log2: [],
            log3: []
        });
    });

    t.test('provision nic2', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[1].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[4],
                cn_uuid: SERVERS[1],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[1], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[4],
                cn_uuid: SERVERS[1],
                fabric: true,
                nic_tag: nic_tag,
                owner_uuid: OWNERS[0]
            })
        });
    });

    t.test('overlay mapping updated', function (t2) {
        nic2 = mod_nic.lastCreated();
        t.ok(nic2, 'last created nic');

        nic2vl3s1 = {
            vnet_id: vnet_id,
            version: 1,
            record: {
                type: 'SVP_LOG_VL3',
                ip: nic2.ip,
                mac: nic2.mac,
                vlan: vlan_id,
                vnet_id: vnet_id
            }
        };

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic2
            },
            exp: {
                cn_uuid: SERVERS[1],
                deleted: false,
                ip: nic2.ip,
                mac: nic2.mac,
                version: 1,
                vnet_id: vnet_id
            }
        });
    });

    t.test('Checking VL3 shootdowns', function (t2) {
        checkEventLog(t2, {
            log1: [ extend(nic2vl3s1, { cn_uuid: SERVERS[0] }) ],
            log2: [],
            log3: []
        });
    });

    t.test('NAPI-397: update fabric NIC to new IP address', function (t2) {
        var params = {
            ip: newIP
        };
        mod_nic.updateAndGet(t2, {
            mac: nic1.mac,
            params: params,
            exp: extend(nic1, params),
            ignore: [ 'modified_timestamp' ]
        });
    });

    t.test('old overlay mapping updated to deleted=true', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic1
            },
            skipVL2: true,
            expErr: mod_portolan.notFoundErr()
        });
    });

    t.test('new overlay mapping updated', function (t2) {
        nic1.ip = newIP;
        nic1vl3s2 = {
            vnet_id: vnet_id,
            version: 1,
            record: {
                type: 'SVP_LOG_VL3',
                ip: newIP,
                mac: nic1.mac,
                vlan: vlan_id,
                vnet_id: vnet_id
            }
        };

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic1
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: newIP,
                mac: nic1.mac,
                version: 1,
                vnet_id: vnet_id
            }
        });
    });

    t.test('Checking VL3 shootdowns', function (t2) {
        checkEventLog(t2, {
            log1: [
                extend(nic1vl3s1, { cn_uuid: SERVERS[0] }),
                extend(nic1vl3s2, { cn_uuid: SERVERS[0] })
            ],
            log2: [
                extend(nic1vl3s1, { cn_uuid: SERVERS[1] }),
                extend(nic1vl3s2, { cn_uuid: SERVERS[1] })
            ],
            log3: []
        });
    });

    t.test('NAPI-358: update nic1.cn_uuid to SERVERS[1]', function (t2) {
        nic1.cn_uuid = SERVERS[1];

        mod_nic.updateAndGet(t2, {
            mac: nic1.mac,
            params: {
                cn_uuid: SERVERS[1]
            },
            exp: nic1,
            ignore: [ 'modified_timestamp' ]
        });
    });

    t.test('new overlay mapping updated', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic1
            },
            exp: {
                cn_uuid: SERVERS[1],
                deleted: false,
                ip: newIP,
                mac: nic1.mac,
                version: 1,
                vnet_id: vnet_id
            }
        });
    });

    t.test('Checking VL2 & VL3 shootdowns', function (t2) {
        checkEventLog(t2, {
            log1: [
                extend(nic1vl3s2, { cn_uuid: SERVERS[0] }),
                extend(nic1vl2s1, { cn_uuid: SERVERS[0] })
            ],
            log2: [
                extend(nic1vl3s2, { cn_uuid: SERVERS[1] }),
                extend(nic1vl2s1, { cn_uuid: SERVERS[1] })
            ],
            log3: []
        });
    });

    t.test('deleting nic1', function (t2) {
        mod_nic.del(t2, {
            mac: nic1.mac,
            exp: {}
        });
    });

    t.test('overlay mapping updated to deleted=true', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic1
            },
            expErr: mod_portolan.notFoundErr()
        });
    });

    t.test('Checking VL2 & VL3 shootdowns', function (t2) {
        checkEventLog(t2, {
            log1: [ extend(nic1vl2s1, { cn_uuid: SERVERS[0] }) ],
            log2: [ extend(nic1vl2s1, { cn_uuid: SERVERS[1] }) ],
            log3: []
        });
    });
});



test('provision gateway', function (t) {

    var gw = mod_uuid.v4();
    var gwNic;
    var nicTags = [
        mod_fabric_net.nicTag(t, NETS[0]),
        mod_fabric_net.nicTag(t, NETS[3])
    ];


    t.test('NETS[0]: nic has gateway_provisioned=false', function (t2) {
        mod_nic.get(t2, {
            mac: CREATED.net0nic.mac,
            partialExp: {
                gateway_provisioned: false
            }
        });
    });


    t.test('NETS[0]: provision gateway', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: gw,
                cn_uuid: SERVERS[0],
                ip: NETS[0].gateway,
                owner_uuid: ADMIN_OWNER
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: gw,
                cn_uuid: SERVERS[0],
                fabric: true,
                internet_nat: true,
                gateway_provisioned: true,
                nic_tag: nicTags[0],
                owner_uuid: ADMIN_OWNER
            })
        });
    });


    t.test('get network after gateway provision', function (t2) {
        NETS[0].gateway_provisioned = true;
        gwNic = mod_nic.lastCreated();

        mod_net.get(t2, {
            params: {
                uuid: NETS[0].uuid
            },
            exp: mod_fabric_net.toRealNetObj(NETS[0])
        });
    });


    t.test('updating gateway should be disallowed', function (t2) {
        mod_net.update(t2, {
            params: {
                uuid: NETS[0].uuid,
                gateway: NETS[0].gateway
            },
            expErr: mod_err.invalidParam('gateway',
                'Fabric network updates for this field are not supported')
        });
    });


    t.test('updating gateway_provisioned should be disallowed', function (t2) {
        mod_net.update(t2, {
            params: {
                uuid: NETS[0].uuid,
                gateway_provisioned: false
            },
            expErr: mod_err.invalidParam('gateway_provisioned',
                'Fabric network updates for this field are not supported: ' +
                'delete the gateway NIC instead')
        });
    });


    t.test('updating internet_nat should be disallowed', function (t2) {
        mod_net.update(t2, {
            params: {
                uuid: NETS[0].uuid,
                internet_nat: false
            },
            expErr: mod_err.invalidParam('internet_nat',
                'Fabric network updates for this field are not supported')
        });
    });


    // Now that we have a gateway provisioned, the nic should indicate that
    // the gateway is provisioned
    t.test('NETS[0]: nic has gateway_provisioned=true', function (t2) {
        mod_nic.get(t2, {
            mac: CREATED.net0nic.mac,
            partialExp: {
                gateway_provisioned: true
            }
        });
    });


    t.test('NETS[0]: provision another nic', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[0].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                fabric: true,
                internet_nat: true,
                gateway_provisioned: true,
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            })
        });
    });


    t.test('delete NETS[0] not allowed', function (t2) {
        var anotherNic = mod_nic.lastCreated();
        var expected = [CREATED.net0nic, gwNic, anotherNic];
        mod_fabric_net.del(t2, {
            params: {
                uuid: NETS[0].uuid,
                owner_uuid: NETS[0].owner_uuid,
                vlan_id: NETS[0].vlan_id
            },
            expErr: mod_err.netHasNicsErr(expected)
        });
    });

    t.test('delete nic', function (t2) {
        mod_nic.del(t2, {
            mac: gwNic.mac,
            exp: {}
        });
    });


    t.test('get network after gateway delete', function (t2) {
        NETS[0].gateway_provisioned = false;
        gwNic = mod_nic.lastCreated();

        mod_net.get(t2, {
            params: {
                uuid: NETS[0].uuid
            },
            exp: mod_fabric_net.toRealNetObj(NETS[0])
        });
    });


    t.test('NETS[0]: nic back to gateway_provisioned=false', function (t2) {
        mod_nic.get(t2, {
            mac: CREATED.net0nic.mac,
            partialExp: {
                gateway_provisioned: false
            }
        });
    });

    // XXX: Update gw nic and make sure things stay the same

    // XXX: test to make sure the user can't provision the gateway on their
    // own
});


test('NAPI-348: Provision with fabric nic_tag', function (t) {
    var expTag = mod_fabric_net.nicTag(t, NETS[3]);

    t.test('provision NIC on NETS[3]', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS[3].uuid,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                nic_tag: expTag,
                owner_uuid: OWNERS[1]
            },
            exp: mod_net.addNetParams(NETS[3], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                cn_uuid: SERVERS[0],
                fabric: true,
                internet_nat: false,
                nic_tag: expTag,
                owner_uuid: OWNERS[1]
            })
        });
    });

    t.test('overlay mapping added for NIC', function (t2) {
        var nic = mod_nic.lastCreated();
        t.ok(nic, 'last created nic');

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: nic.ip,
                mac: nic.mac,
                version: 1,
                vnet_id: mod_portolan.nicVnetID(t, nic)
            }
        });
    });
});


test('Provision fabric NIC - IP specified w/o network_uuid', function (t) {
    var ip = '192.168.0.150';
    var mac = h.randomMAC();
    var nic_tag = mod_fabric_net.nicTag(t, NETS[3]);
    var params = {
        ip: ip,
        nic_tag: nic_tag,
        vlan_id: NETS[3].vlan_id,
        belongs_to_type: 'zone',
        belongs_to_uuid: VMS[2],
        primary: false,
        state: 'running',
        cn_uuid: SERVERS[0],
        owner_uuid: OWNERS[1]
    };
    var exp = mod_net.addNetParams(NETS[3],
        extend(params, { fabric: true, network_uuid: NETS[3] }));

    t.test('NETS[3]: provision', function (t2) {
        mod_nic.createAndGet(t2, {
            mac: mac,
            params: params,
            exp: exp
        });
    });

    t.test('overlay mapping added', function (t2) {
        var nic = mod_nic.lastCreated();
        t.ok(nic, 'last created nic');

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: nic
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: ip,
                mac: mac,
                version: 1,
                vnet_id: mod_portolan.nicVnetID(t, nic)
            }
        });
    });
});


// --- Delete tests


test('delete server nic', function (t) {
    t.test('delete server nic', function (t2) {
        t.ok(SERVER_NICS[1], 'have underlay nic');
        t.ok(SERVER_NICS[1].underlay, 'nic has underlay property');

        mod_nic.del(t2, {
            mac: SERVER_NICS[1].mac,
            exp: {}
        });
    });


    t.test('underlay mapping removed', function (t2) {
        mod_portolan.underlayMapping(t2, {
            params: {
                cn_uuid: SERVERS[0]
            },
            expErr: mod_portolan.notFoundErr()
        });
    });
});


// Create network tests:
//
// - Can't create public (non-RFC1918) nets
// - Can create same subnet with multiple owners
// - Can't create overlapping subnet with same owner
// - Invalid routes
// - Try to create networks that are larger than the RFC1918 space
//   - or resize around them
// - check that the first 4 addresses are reserved
// - and the last one
// - mtu: < nic tag's mtu
// - Make sure we can't use body params to override vlan_id or owner


// Update tests:
// - Can't update owner_uuids or vlan_id
// - Can't set another owner UUID on a fabric network


// Provision tests:
// - Pick IP not in subnet


// List networks
//
// - Check that you can see them in /networks
// - Only owner_uuid


// Ownership tests:
//
// - Don't allow deleting someone else's network
// - Listing
// - Updating
// - Getting


// Limit tests:
//
// Try to create over 1k (the limit) for:
// - vlans
// - networks

// Other tests:
//
// - Don't allow deleting the overlay or underlay tags
// - Don't allow setting the underlay tag:
//   - on more than one server nic
//   - if belongs_to_type !== 'server'
// - Validation of underlay param
// - Update a server's nic to add the underlay param
// - Only allow provisioning fabric networks on the overlay nic


test('delete vlan with networks on it not allowed', function (t) {
    mod_vlan.del(t, {
        params: {
            owner_uuid: VLANS[0].owner_uuid,
            vlan_id: VLANS[0].vlan_id
        },
        expErr: mod_err.vlanHasNetworks([NETS[0], NETS[1]])
    });
});



test('teardown', function (t) {
    t.test('delete created nics', mod_nic.delAllCreated);

    t.test('delete created networks', mod_net.delAllCreated);

    t.test('delete created fabric networks', mod_fabric_net.delAllCreated);

    t.test('delete created VLANs', mod_vlan.delAllCreated);

    t.test('close portolan client', mod_portolan.closeClient);

});
