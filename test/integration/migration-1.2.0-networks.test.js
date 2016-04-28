/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Network migration tests
 */

'use strict';

var constants = require('../../lib/util/constants');
var extend = require('xtend');
var mod_ip = require('../lib/ip');
var mod_migr = require('../lib/migration');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nictag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var test = require('tape');



// --- Globals



var BUCKETS = {
    adminIPs: ipsBucketV1('napi_ips_07eef409_c6eb_42cb_8712_bb0deaab8108'),

    networks: {
        desc: 'network',
        name: 'napi_networks',
        schema: {
            index: {
                name: { type: 'string', unique: true },
                nic_tag: { type: 'string' },
                owner_uuids: { type: 'string' },
                subnet_end_ip: { type: 'number' },
                subnet_start_ip: { type: 'number' },
                uuid: { type: 'string', unique: true },
                v: { type: 'number' },
                vlan_id: { type: 'number' }
            }
        },
        migrationVersion: 2,    // must be > version
        version: 1
    },

    nics: {
        desc: 'nic',
        name: 'napi_nics',
        schema: {
            index: {
                belongs_to_type: { type: 'string' },
                belongs_to_uuid: { type: 'string' },
                ip: { type: 'number' },
                mac: { type: 'number', unique: true },
                nic_tag: { type: 'string' },
                nic_tags_provided: { type: 'string' },
                owner_uuid: { type: 'string' },
                primary_flag: { type: 'boolean' }
            }
        }
    },

    nictags: {
        desc: 'nic tag',
        name: 'napi_nic_tags',
        schema: {
            index: {
                name: { type: 'string', unique: true },
                uuid: { type: 'string', unique: true }
            }
        }
    }
};

var VERSIONS = {
    networks: 3,
    nics: 2,
    nictags: 1
};

var NETS = {
    admin: '07eef409-c6eb-42cb-8712-bb0deaab8108',
    external: '62525d6e-466e-464b-892d-01f925a12fae'
};

var NICS = {
    serverNoIP: '345044264853',
    serverWithIP: '345043656780',
    zone0: '108005419488235',
    zone1Primary: '108005419488236',
    zone1NotPrimary: '108005419488237'
};

var OWNERS = {
    admin: '930896af-bf8c-48d4-885c-6573a94b1853',
    user0: '95672b8e-5690-4428-b0d2-72c700cf3cf8'
};

var SERVERS = [
    mod_uuid.v4()
];

var VMS = [
    '98643c6e-cc7a-45ae-b70c-f9e93cdfefa3',
    mod_uuid.v4()
];

var INITIAL = {
    adminIPs: [
        {
            key: '174285605',
            value: { ip: 174285605, reserved: false }
        },
        {
            key: '174285822',
            value: { ip: 174285822, reserved: false }
        },
        {
            key: '174285823',
            value: {
                ip: 174285823,
                reserved: true,
                belongs_to_type: 'other',
                belongs_to_uuid: OWNERS.admin,
                owner_uuid: OWNERS.admin
            }
        },
        {
            key: '174285575',
            value: {
                ip: 174285575,
                reserved: false,
                belongs_to_type: 'server',
                belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
                owner_uuid: OWNERS.admin
            }
        },
        {
            bucket: 'napi_ips_07eef409_c6eb_42cb_8712_bb0deaab8108',
            key: '174285576',
            value: {
                ip: 174285576,
                reserved: false,
                belongs_to_type: 'zone',
                belongs_to_uuid: VMS[0],
                owner_uuid: OWNERS.admin
            }
        },
        {
            bucket: 'napi_ips_07eef409_c6eb_42cb_8712_bb0deaab8108',
            key: '174285584',
            value: {
                ip: 174285584,
                reserved: false,
                belongs_to_type: 'zone',
                belongs_to_uuid: '7506f663-a7c8-4e03-afc6-c4eae84a611d',
                owner_uuid: OWNERS.admin
            }
        }
    ],

    nets: [
        {
            key: NETS.external,
            value: {
                uuid: NETS.external,
                name: 'external',
                name_str: 'global:external',
                vlan_id: 0,
                subnet_end_ip: 173562111,
                subnet_start_ip: 173561856,
                subnet_bits: 24,
                provision_start_ip: 173561859,
                provision_end_ip: 173562055,
                nic_tag: 'external',
                v: 2,
                gateway: 173561858,
                resolvers: [ 134744072, 134743044 ]
            }
        },
        {
            key: NETS.admin,
            value: {
                uuid: NETS.admin,
                name: 'admin',
                name_str: 'global:admin',
                vlan_id: 0,
                subnet_end_ip: 174285823,
                subnet_start_ip: 174285568,
                subnet_bits: 24,
                provision_start_ip: 174285606,
                provision_end_ip: 174285821,
                nic_tag: 'admin',
                v: 2,
                owner_uuids: ',930896af-bf8c-48d4-885c-6573a94b1853,',
                resolvers: [ 174285579 ],
                routes: {
                    '167903232/16': 167837953,
                    '167968768': 167837954
                }
            }
        }
    ],

    nics: [
        {
            key: NICS.serverNoIP,
            value: {
                mac: 345044264853,
                owner_uuid: OWNERS.admin,
                belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
                belongs_to_type: 'server',
                primary_flag: false,
                state: constants.DEFAULT_NIC_STATE,
                nic_tags_provided: ',external,'
            }
        },
        {
            key: NICS.serverWithIP,
            value: {
                mac: 345043656780,
                owner_uuid: OWNERS.admin,
                belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
                belongs_to_type: 'server',
                primary_flag: false,
                state: constants.DEFAULT_NIC_STATE,
                ip: 174285575,
                network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108',
                nic_tag: 'admin',
                free: false,
                nic_tags_provided: ',admin,'
            }
        },
        {
            key: NICS.zone0,
            value: {
                mac: 108005419488235,
                owner_uuid: OWNERS.admin,
                belongs_to_uuid: VMS[0],
                belongs_to_type: 'zone',
                primary_flag: true,
                state: constants.DEFAULT_NIC_STATE,
                ip: 174285576,
                network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108',
                nic_tag: 'admin',
                free: false
            }
        },
        {
            key: '160877044352298',
            value: {
                mac: 160877044352298,
                owner_uuid: OWNERS.admin,
                belongs_to_uuid: '7506f663-a7c8-4e03-afc6-c4eae84a611d',
                belongs_to_type: 'zone',
                primary_flag: true,
                state: constants.DEFAULT_NIC_STATE,
                ip: 174285584,
                network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108',
                nic_tag: 'admin',
                free: false
            }
        },

        // zone nics to test that we're not running the updates in nic.batch()

        {
            key: NICS.zone1Primary,
            value: {
                mac: NICS.zone1Primary,
                owner_uuid: OWNERS.user0,
                belongs_to_uuid: VMS[1],
                belongs_to_type: 'zone',
                primary_flag: true,
                state: constants.DEFAULT_NIC_STATE,
                nic_tag: 'external'
            }
        },
        {
            key: NICS.zone1NotPrimary,
            value: {
                mac: NICS.zone1NotPrimary,
                owner_uuid: OWNERS.user0,
                belongs_to_uuid: VMS[1],
                belongs_to_type: 'zone',
                primary_flag: false,
                state: constants.DEFAULT_NIC_STATE,
                nic_tag: 'external'
            }
        }
    ],

    nictags: [
        {
            key: 'external',
            value: {
                uuid: 'b1f21239-ba2a-467e-bca6-af72aadd422e',
                name: 'external'
            }
        },
        {
            key: 'admin',
            value: {
                uuid: '060d26e3-81f4-4912-82e0-7e38b0389705',
                name: 'admin'
            }
        }
    ]
};

var EXP = {
    nets: [
        {
            uuid: NETS.external,
            mtu: constants.MTU_DEFAULT,
            name: 'external',
            vlan_id: 0,
            subnet: '10.88.88.0/24',
            netmask: '255.255.255.0',
            provision_start_ip: '10.88.88.3',
            provision_end_ip: '10.88.88.199',
            nic_tag: 'external',
            resolvers: [ '8.8.8.8', '8.8.4.4' ],
            gateway: '10.88.88.2'
        },
        {
            uuid: NETS.admin,
            mtu: constants.MTU_DEFAULT,
            name: 'admin',
            vlan_id: 0,
            subnet: '10.99.99.0/24',
            netmask: '255.255.255.0',
            provision_start_ip: '10.99.99.38',
            provision_end_ip: '10.99.99.253',
            nic_tag: 'admin',
            resolvers: [ '10.99.99.11' ],
            routes: {
                '10.2.0.0/16': '10.1.1.1',
                '10.3.0.0': '10.1.1.2'
            },
            owner_uuids: [ OWNERS.admin ]
        }
    ],

    nics: [
        {
            belongs_to_type: 'server',
            belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
            mac: '00:50:56:3d:a7:95',
            owner_uuid: OWNERS.admin,
            primary: false,
            state: constants.DEFAULT_NIC_STATE,
            nic_tags_provided: [ 'external' ]
        },
        {
            belongs_to_type: 'server',
            belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
            mac: '00:50:56:34:60:4c',
            owner_uuid: OWNERS.admin,
            primary: false,
            state: constants.DEFAULT_NIC_STATE,
            ip: '10.99.99.7',
            mtu: constants.MTU_DEFAULT,
            netmask: '255.255.255.0',
            vlan_id: 0,
            nic_tag: 'admin',
            resolvers: [ '10.99.99.11' ],
            routes: {
                '10.2.0.0/16': '10.1.1.1',
                '10.3.0.0': '10.1.1.2'
            },
            network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108',
            nic_tags_provided: [ 'admin' ]
        },
        {
            belongs_to_type: 'zone',
            belongs_to_uuid: VMS[0],
            mac: '62:3a:f8:a9:93:eb',
            mtu: constants.MTU_DEFAULT,
            owner_uuid: OWNERS.admin,
            primary: true,
            state: constants.DEFAULT_NIC_STATE,
            ip: '10.99.99.8',
            netmask: '255.255.255.0',
            vlan_id: 0,
            nic_tag: 'admin',
            resolvers: [ '10.99.99.11' ],
            routes: {
                '10.2.0.0/16': '10.1.1.1',
                '10.3.0.0': '10.1.1.2'
            },
            network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108'
        },
        {
            belongs_to_type: 'zone',
            belongs_to_uuid: '7506f663-a7c8-4e03-afc6-c4eae84a611d',
            mac: '92:51:1b:14:c5:2a',
            mtu: constants.MTU_DEFAULT,
            owner_uuid: OWNERS.admin,
            primary: true,
            state: constants.DEFAULT_NIC_STATE,
            ip: '10.99.99.16',
            netmask: '255.255.255.0',
            vlan_id: 0,
            nic_tag: 'admin',
            resolvers: [ '10.99.99.11' ],
            routes: {
                '10.2.0.0/16': '10.1.1.1',
                '10.3.0.0': '10.1.1.2'
            },
            network_uuid: '07eef409-c6eb-42cb-8712-bb0deaab8108'
        },

        {
            belongs_to_type: 'zone',
            belongs_to_uuid: VMS[1],
            mac: '62:3a:f8:a9:93:ec',
            owner_uuid: OWNERS.user0,
            primary: true,
            state: constants.DEFAULT_NIC_STATE,
            nic_tag: 'external'
        },
        {
            belongs_to_type: 'zone',
            belongs_to_uuid: VMS[1],
            mac: '62:3a:f8:a9:93:ed',
            owner_uuid: OWNERS.user0,
            primary: false,
            state: constants.DEFAULT_NIC_STATE,
            nic_tag: 'external'
        }
    ],

    adminIPs: [
        mod_ip.freeIP(NETS.admin, '10.99.99.37'),
        mod_ip.freeIP(NETS.admin, '10.99.99.254'),
        {
            ip: '10.99.99.255',
            free: false,
            reserved: true,
            belongs_to_type: 'other',
            belongs_to_uuid: OWNERS.admin,
            network_uuid: NETS.admin,
            owner_uuid: OWNERS.admin
        },
        {
            ip: '10.99.99.7',
            free: false,
            reserved: false,
            belongs_to_type: 'server',
            belongs_to_uuid: '564d843f-7cc8-835e-33f0-2f2a151bdfb4',
            network_uuid: NETS.admin,
            owner_uuid: OWNERS.admin
        },
        {
            ip: '10.99.99.8',
            free: false,
            reserved: false,
            belongs_to_type: 'zone',
            belongs_to_uuid: VMS[0],
            network_uuid: NETS.admin,
            owner_uuid: OWNERS.admin
        },
        {
            ip: '10.99.99.16',
            free: false,
            reserved: false,
            belongs_to_type: 'zone',
            belongs_to_uuid: '7506f663-a7c8-4e03-afc6-c4eae84a611d',
            network_uuid: NETS.admin,
            owner_uuid: OWNERS.admin
        }
    ]
};




// --- Internal



function ipsBucketV1(name) {
    return {
        desc: 'IP',
        name: name,
        schema: {
            index: {
                belongs_to_type: { type: 'string' },
                belongs_to_uuid: { type: 'string' },
                owner_uuid: { type: 'string' },
                ip: { type: 'number', unique: true },
                reserved: { type: 'boolean' }
            }
        }
    };
}



// --- Tests



test('setup', function (t) {
    t.test('delete previous test buckets', mod_migr.delAllPrevious);
});


test('migrate', function (t) {
    t.test('load initial data: networks', function (t2) {
        mod_migr.initBucket(t2, {
            bucket: BUCKETS.networks,
            records: INITIAL.nets
        });
    });


    t.test('load initial data: admin ips', function (t2) {
        mod_migr.initBucket(t2, {
            bucket: BUCKETS.adminIPs,
            records: INITIAL.adminIPs
        });
    });


    t.test('load initial data: nics', function (t2) {
        mod_migr.initBucket(t2, {
            bucket: BUCKETS.nics,
            records: INITIAL.nics
        });
    });


    t.test('load initial data: nic tags', function (t2) {
        mod_migr.initBucket(t2, {
            bucket: BUCKETS.nictags,
            records: INITIAL.nictags
        });
    });


    t.test('create server', mod_server.create);


    t.test('run migrations', mod_migr.run);

});

test('networks', function (t) {

    t.test('check networks', function (t2) {
        mod_net.list(t2, {
            deepEqual: true,
            params: {},
            present: EXP.nets
        });
    });


    t.test('moray: external net', function (t2) {
        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.networks,
            key: NETS.external,
            exp: extend(INITIAL.nets[0].value, {
                fabric: false,
                gateway_addr: '10.88.88.2',
                internet_nat: true,
                ip_use_strings: false,
                mtu: constants.MTU_DEFAULT,
                provision_end_ip_addr: '10.88.88.199',
                provision_start_ip_addr: '10.88.88.3',
                resolver_addrs: [ '8.8.8.8', '8.8.4.4' ],
                subnet: '10.88.88.0/24',
                subnet_start: '10.88.88.0',
                subnet_type: 'ipv4',
                v: VERSIONS.networks
            })
        });
    });


    t.test('moray: admin net', function (t2) {
        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.networks,
            key: NETS.admin,
            exp: extend(INITIAL.nets[1].value, {
                fabric: false,
                internet_nat: true,
                ip_use_strings: false,
                mtu: constants.MTU_DEFAULT,
                owner_uuids_arr: [ OWNERS.admin ],
                provision_end_ip_addr: '10.99.99.253',
                provision_start_ip_addr: '10.99.99.38',
                resolver_addrs: [ '10.99.99.11' ],
                route_addrs: {
                    '10.2.0.0/16': '10.1.1.1',
                    '10.3.0.0': '10.1.1.2'
                },
                subnet: '10.99.99.0/24',
                subnet_start: '10.99.99.0',
                subnet_type: 'ipv4',
                v: VERSIONS.networks
            })
        });
    });

    // XXX: need to confirm that we're favouring the new values for things
    // over the old backward-compatible ones
});


test('IPs', function (t) {

    t.test('check admin IPs', function (t2) {
        mod_ip.list(t2, {
            deepEqual: true,
            net: NETS.admin,
            params: {},
            present: EXP.adminIPs
        });
    });

    // Do a mod_ip.get on an IP:
    // - in moray
    // - not in moray (free)

});


test('nics', function (t) {

    t.test('check nics', function (t2) {
        mod_nic.list(t2, {
            deepEqual: true,
            params: {},
            present: EXP.nics
        });
    });


    t.test('moray: server nic with no IP', function (t2) {
        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.nics,
            key: NICS.serverNoIP,
            exp: extend(INITIAL.nics[0].value, {
                nic_tags_provided_arr: [ 'external' ],
                v: VERSIONS.nics
            })
        });
    });


    t.test('moray: server nic with IP', function (t2) {
        var exp = extend(INITIAL.nics[1].value, {
            ipaddr: '10.99.99.7',
            nic_tags_provided_arr: [ 'admin' ],
            v: VERSIONS.nics
        });
        delete exp.free;

        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.nics,
            key: NICS.serverWithIP,
            exp: exp
        });
    });


    t.test('moray: zone nic with IP', function (t2) {
        var exp = extend(INITIAL.nics[2].value, {
            ipaddr: '10.99.99.8',
            v: VERSIONS.nics
        });
        delete exp.free;

        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.nics,
            key: NICS.zone0,
            exp: exp
        });
    });


    // Make sure we can provision on the newly-migrated network:
    t.test('provision admin nic', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NETS.admin,
            params: {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                owner_uuid: OWNERS.admin
            },
            exp: mod_net.addNetParams(EXP.nets[1], {
                belongs_to_type: 'server',
                belongs_to_uuid: SERVERS[0],
                // It should get provision_start_ip, since it hasn't been
                // taken yet:
                ip: '10.99.99.38',
                owner_uuid: OWNERS.admin
            })
        });
    });

    // XXX: need to confirm that we're favouring the new values for things
    // over the old backward-compatible ones

});


test('nic tags', function (t) {

    t.test('check nic tags', function (t2) {
        mod_nictag.list(t2, {
            deepEqual: true,
            params: {},
            present: EXP.nictags
        });
    });


    t.test('moray: admin nic tag', function (t2) {
        mod_migr.getMorayObj(t2, {
            bucket: BUCKETS.nictags,
            key: 'admin',
            exp: extend(INITIAL.nictags[1].value, {
                mtu: constants.MTU_DEFAULT,
                v: VERSIONS.nictags
            })
        });
    });

});


test('teardown', function (t) {
    t.test('shutdown server', mod_server.close);

    t.test('delete test buckets', mod_migr.delAllCreated);

    t.test('close moray client', mod_migr.closeClient);
});
