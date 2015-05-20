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
var config = require('../lib/config');
var constants = require('../../lib/util/constants');
var extend = require('xtend');
var h = require('./helpers');
var mod_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var mod_fabric_net = require('../lib/fabric-net');
var mod_nic = require('../lib/nic');
var mod_nic_tag = require('../lib/nic-tag');
var mod_net = require('../lib/net');
var mod_portolan = require('../lib/portolan');
var mod_vlan = require('../lib/vlan');
var test = require('../lib/fabrics').testIfEnabled;



// --- Globals



var ADMIN_OWNER;    // Loaded in setup below
var CREATED = {};
// XXX: shouldn't have to do this!
var NAPI = h.createNAPIclient();
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

    // 3: same subnet range as 2, but different owner
    {
        vlan_id: VLANS[2].vlan_id,
        subnet: '192.168.0.0/24',
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
        name: mod_fabric_net.generateName('fields'),
        owner_uuid: VLANS[3].owner_uuid,
        provision_start_ip: '172.16.1.1',
        provision_end_ip: '172.16.3.254'
    }

];
var VMS = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];
var SERVERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];
var SERVER_NICS = [];



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


    t.test('REAL_NETS[0]: provision underlay nic', function (t2) {
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

    // XXX: disallow provisioning fabric networks on the underlay nic tag!

});


test('provision zone nics', function (t) {

    var nicTags = [
        mod_fabric_net.nicTag(t, NETS[0]),
        mod_fabric_net.nicTag(t, NETS[3])
    ];
    var updateNic;

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
                fabric: true,
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            })
        });
    });


    // We didn't specify cn_uuid when provisioning the last nic, so it should
    // not have an overlay mapping
    t.test('nic 0: overlay mapping not added', function (t2) {
        updateNic = mod_nic.lastCreated();
        t.ok(updateNic, 'last created nic');

        mod_portolan.overlayMapping(t2, {
            params: {
                nic: updateNic
            },
            expErr: mod_portolan.notFoundErr()
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
                fabric: true,
                ip: '10.2.1.40',
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
                owner_uuid: OWNERS[1]
            },
            exp: mod_net.addNetParams(NETS[3], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                fabric: true,
                nic_tag: nicTags[1],
                owner_uuid: OWNERS[1]
            })
        });
    });


    t.test('update nic to add cn_uuid', function (t2) {
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


    t.test('updated nic: overlay mapping added', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: updateNic
            },
            exp: {
                cn_uuid: SERVERS[1],
                deleted: false,
                ip: updateNic.ip,
                mac: updateNic.mac,
                vnet_id: mod_portolan.nicVnetID(t, updateNic)
            }
        });
    });


    t.test('update nic to change cn_uuid', function (t2) {
        mod_nic.updateAndGet(t2, {
            mac: updateNic.mac,
            params: {
                cn_uuid: SERVERS[0]
            },
            partialExp: {
                cn_uuid: SERVERS[0]
            }
        });
    });


    t.test('updated nic: overlay mapping changed', function (t2) {
        mod_portolan.overlayMapping(t2, {
            params: {
                nic: updateNic
            },
            exp: {
                cn_uuid: SERVERS[0],
                deleted: false,
                ip: updateNic.ip,
                mac: updateNic.mac,
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
            exp: CREATED.updateNic
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
                ip: NETS[0].gateway,
                owner_uuid: ADMIN_OWNER
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: gw,
                fabric: true,
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
                owner_uuid: OWNERS[0]
            },
            exp: mod_net.addNetParams(NETS[0], {
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[2],
                fabric: true,
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


// Delete tests:
//
// - Don't allow deleting a network if it has nics on it
// - Don't allow deleting a VLAN if it has networks on it


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


test('teardown', function (t) {
    t.test('delete created nics', mod_nic.delAllCreated);

    t.test('delete created networks', mod_net.delAllCreated);

    t.test('delete created fabric networks', mod_fabric_net.delAllCreated);

    t.test('delete created VLANs', mod_vlan.delAllCreated);

    t.test('close portolan client', mod_portolan.closeClient);

});
