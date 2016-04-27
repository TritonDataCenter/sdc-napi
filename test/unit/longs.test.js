/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * No ip_use_strings field unit tests
 *
 * Older versions of NAPI used the numeric representation of IPv4 addresses
 * as keys and for other values. These tests make sure that NAPI continues
 * to work with networks created before changing to string representations.
 */

'use strict';

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var ipaddr = require('ip6addr');
var mod_ip = require('../lib/ip');
var mod_net = require('../lib/net');
var mod_nic_tag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util = require('util');

// --- Globals


var MORAY;
var NAPI;
var NET_UUID = mod_uuid.v4();
var ZONE1_UUID = mod_uuid.v4();
var IPS_BUCKET = util.format('napi_ips_%s', NET_UUID.replace(/-/g, '_'));
var OLD_IP_SCHEMA = {
    index: {
        belongs_to_type: { type: 'string' },
        belongs_to_uuid: { type: 'string' },
        owner_uuid: { type: 'string' },
        ip: { type: 'number', unique: true },
        reserved: { type: 'boolean' }
    },
    options: {
        version: 2
    }
};

// --- Setup


test('Initial setup', function (t) {
    h.reset();

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res, moray) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            t2.ok(moray, 'moray');
            NAPI = res;
            MORAY = moray;

            t2.end();
        });
    });

    t.test('create default nic tag', mod_nic_tag.createDefault);

    t.test('create nic tag', function (t2) {
        mod_nic_tag.create(t2, {
            name: 'nic_tag'
        });
    });

    t.test('create network in moray', function (t2) {
        var prov_start_ip = ipaddr.parse('10.0.128.30').toLong();
        var prov_end_ip = ipaddr.parse('10.0.130.254').toLong();
        var subnet_start_ip = ipaddr.parse('10.0.128.0').toLong();
        var subnet_end_ip = ipaddr.parse('10.0.135.255').toLong();
        var resolver = ipaddr.parse('10.0.128.13').toLong();
        var gateway = ipaddr.parse('10.0.128.1').toLong();

        t2.deepEqual(prov_start_ip, 167804958, 'prov_start_ip');
        t2.deepEqual(prov_end_ip, 167805694, 'prov_end_ip');
        t2.deepEqual(subnet_start_ip, 167804928, 'subnet_start_ip');
        t2.deepEqual(subnet_end_ip, 167806975, 'subnet_end_ip');
        t2.deepEqual(resolver, 167804941, 'resolver');
        t2.deepEqual(gateway, 167804929, 'gateway');

        MORAY.putObject('napi_networks', NET_UUID, {
            'name_str': 'global:admin',
            'subnet_type': 'ipv4',
            'nic_tag': 'admin',
            'uuid': NET_UUID,
            'vlan_id': 0,
            'subnet_bits': 21,
            'provision_start_ip': prov_start_ip,
            'provision_end_ip': prov_end_ip,
            'subnet_start_ip': subnet_start_ip,
            'subnet_end_ip': subnet_end_ip,
            'owner_uuids': ',' + constants.UFDS_ADMIN_UUID + ',',
            'resolvers': [ resolver ],
            'routes': {
                '168427520/18': gateway,
                '168361984/18': gateway,
                '167772160/11': { octets: [ 10, 0, 128, 1 ] }
            },
            'gateway': gateway
        }, {}, function (err, res) {
            t2.ifError(err, 'creating network');
            t2.end();
        });
    });

    t.test('create ips bucket', function (t2) {
        MORAY.createBucket(IPS_BUCKET, OLD_IP_SCHEMA, function (err, res) {
            t2.ifError(err, 'creating ips bucket');
            t2.end();
        });
    });

    t.test('create beginning boundary', function (t2) {
        MORAY.putObject(IPS_BUCKET, '167804957', {
            'reserved': true,
            'ip': 167804957
        }, {}, function (err, res) {
            t2.ifError(err, 'creating beginning boundary');
            t2.end();
        });
    });

    t.test('create end boundary', function (t2) {
        MORAY.putObject(IPS_BUCKET, '167805695', {
            'ip': 167805695,
            'reserved': true
        }, {}, function (err, res) {
            t2.ifError(err, 'creating end boundary');
            t2.end();
        });
    });


    t.test('create broadcast address', function (t2) {
        MORAY.putObject(IPS_BUCKET, '167806975', {
            'ip': 167806975,
            'reserved': true,
            'belongs_to_type': 'other',
            'belongs_to_uuid': constants.UFDS_ADMIN_UUID,
            'owner_uuid': constants.UFDS_ADMIN_UUID
        }, {}, function (err, res) {
            t2.ifError(err, 'creating broadcast address');
            t2.end();
        });
    });
});



// --- Tests


test('get network', function (t) {
    mod_net.get(t, {
        params: {
            uuid: NET_UUID
        },
        exp: {
            family: 'ipv4',
            gateway: '10.0.128.1',
            mtu: 1500,
            name: 'admin',
            netmask: '255.255.248.0',
            nic_tag: 'admin',
            owner_uuids: [ 'aaaaaaaa-aaaa-aaaa-aaaa-000000000000' ],
            provision_end_ip: '10.0.130.254',
            provision_start_ip: '10.0.128.30',
            resolvers: [ '10.0.128.13' ],
            routes: {
                '10.0.0.0/11': '10.0.128.1',
                '10.10.0.0/18': '10.0.128.1',
                '10.9.0.0/18': '10.0.128.1'
            },
            subnet: '10.0.128.0/21',
            uuid: NET_UUID,
            vlan_id: 0
        }
    });
});


test('get end ip address', function (t) {
    var BROADCAST_ADDR = {
        belongs_to_type: 'other',
        belongs_to_uuid: constants.UFDS_ADMIN_UUID,
        free: false,
        ip: '10.0.135.255',
        network_uuid: NET_UUID,
        owner_uuid: constants.UFDS_ADMIN_UUID,
        reserved: true
    };

    t.test('search by long', function (t2) {
        mod_ip.get(t2, {
            net: NET_UUID,
            ip: '167806975',
            exp: BROADCAST_ADDR
        });
    });

    t.test('search by string', function (t2) {
        mod_ip.get(t2, {
            net: NET_UUID,
            ip: '10.0.135.255',
            exp: BROADCAST_ADDR
        });
    });
});


test('NAPI-319: Update provisioning start', function (t) {
    t.test('first update', function (t2) {
        var params = {
            provision_start_ip: '10.0.128.35'
        };
        NAPI.updateNetwork(NET_UUID, params, function (err, res) {
            t2.ifError(err, 'update provision_start_ip');
            t2.end();
        });
    });

    t.test('second update', function (t2) {
        var params = {
            provision_start_ip: '10.0.128.20'
        };
        NAPI.updateNetwork(NET_UUID, params, function (err, res) {
            t2.ifError(err, 'update provision_start_ip');
            t2.end();
        });
    });
});


test('NAPI-319: Update provisioning end', function (t) {
    t.test('first update', function (t2) {
        var params = {
            provision_end_ip: '10.0.130.50'
        };
        NAPI.updateNetwork(NET_UUID, params, function (err, res) {
            t2.ifError(err, 'update provision_end_ip');
            t2.end();
        });
    });

    t.test('second update', function (t2) {
        var params = {
            provision_end_ip: '10.0.130.250'
        };
        NAPI.updateNetwork(NET_UUID, params, function (err, res) {
            t2.ifError(err, 'update provision_end_ip');
            t2.end();
        });
    });
});


test('NAPI-371: Series of provisions and deletes', function (t) {
    var params = {
        belongs_to_uuid: ZONE1_UUID,
        belongs_to_type: 'zone',
        owner_uuid: constants.UFDS_ADMIN_UUID,
        network_uuid: NET_UUID
    };
    var nic;

    t.test('provision nic (first round)', function (t2) {
        NAPI.provisionNic(NET_UUID, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic')) {
                t2.end();
                return;
            }

            nic = res;
            t2.ok(nic, 'returned nic');
            t2.ok(nic.ip, 'returned nic with ip');
            t2.ok(nic.mac, 'returned nic with mac');
            t2.end();
        });
    });

    t.test('get ip (pre-delete)', function (t2) {
        mod_ip.get(t2, {
            net: NET_UUID,
            ip: nic.ip,
            exp: {
                belongs_to_uuid: ZONE1_UUID,
                belongs_to_type: 'zone',
                free: false,
                ip: nic.ip,
                network_uuid: NET_UUID,
                owner_uuid: constants.UFDS_ADMIN_UUID,
                reserved: false
            }
        });
    });

    t.test('delete nic', function (t2) {
        NAPI.deleteNic(nic.mac, function (err) {
            t2.ifError(err, 'deleted NIC');
            t2.end();
        });
    });

    t.test('get ip (post-delete)', function (t2) {
        mod_ip.get(t2, {
            net: NET_UUID,
            ip: nic.ip,
            exp: {
                free: true,
                ip: nic.ip,
                network_uuid: NET_UUID,
                reserved: false
            }
        });
    });

    t.test('provision nic (second round)', function (t2) {
        NAPI.provisionNic(NET_UUID, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic')) {
                t2.end();
                return;
            }

            nic = res;
            t2.ok(nic, 'returned nic');
            t2.ok(nic.ip, 'returned nic with ip');
            t2.ok(nic.mac, 'returned nic with mac');
            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        NAPI.deleteNic(nic.mac, function (err) {
            t2.ifError(err, 'deleted NIC');
            t2.end();
        });
    });
});


// --- Teardown


test('Stop server', mod_server.close);
