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
var h = require('./helpers');
var mod_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var mod_fabric_net = require('../lib/fabric-net');
var mod_nic = require('../lib/nic');
var mod_nic_tag = require('../lib/nic-tag');
var mod_net = require('../lib/net');
var mod_portolan = require('../lib/portolan');
var mod_vlan = require('../lib/vlan');
var test = require('tape');



// --- Globals



// XXX: make this the actual owner?
var ADMIN_OWNER = mod_uuid.v4();
var CREATED = {};
// XXX: shouldn't have to do this!
var NAPI = h.createNAPIclient();
var OWNERS = [
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
// Real (non-fabric networks):
var REAL_NETS = [
    h.validNetworkParams({ nic_tag: UNDERLAY_NIC_TAG })
];
// Fabric networks:
var NETS = [

    // -- On VLANS[0] (OWNERS[0])

    // 0
    {
        vlan_id: VLANS[0].vlan_id,
        subnet: '10.2.1.0/24',
        gateway: '10.2.1.5',
        mtu: OVERLAY_MTU,
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
        mtu: OVERLAY_MTU,
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
        mtu: OVERLAY_MTU,
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
        mtu: OVERLAY_MTU,
        name: mod_fabric_net.generateName('overlap'),
        owner_uuid: VLANS[2].owner_uuid,
        provision_start_ip: '192.168.0.2',
        provision_end_ip: '192.168.0.254'
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



// --- Tests



test('overlay / underlay nic tags', function (t) {

    t.test('overlay tag', function (t2) {
        mod_nic_tag.get(t2, {
            params: {
                name: OVERLAY_NIC_TAG
            },
            partialExp: {
                mtu: OVERLAY_MTU,
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
            }),
            state: CREATED    // store this nic in CREATED.nics
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
            }),
            state: CREATED    // store this nic in CREATED.nics
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
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            }),
            state: CREATED    // store this nic in CREATED.nics
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
                ip: '10.2.1.40',
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            }),
            state: CREATED    // store this nic in CREATED.nics
        });
    });


    t.test('NETS[1]: provision', function (t2) {
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
                cn_uuid: SERVERS[0],
                nic_tag: nicTags[0],
                owner_uuid: OWNERS[0]
            }),
            state: CREATED    // store this nic in CREATED.nics
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
                nic_tag: nicTags[1],
                owner_uuid: OWNERS[1]
            }),
            state: CREATED    // store this nic in CREATED.nics
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
