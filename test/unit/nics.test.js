/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for nic endpoints
 */

'use strict';

var common = require('../lib/common');
var constants = require('../../lib/util/constants');
var fmt = require('util').format;
var h = require('./helpers');
var ip_common = require('../../lib/models/ip/common');
var mod_err = require('../../lib/util/errors');
var mod_ip = require('../lib/ip');
var mod_jsprim = require('jsprim');
var mod_mac = require('macaddr');
var mod_moray = require('../lib/moray');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nicTag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var models = require('../../lib/models');
var test = require('tape');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');

var extend = mod_jsprim.mergeObjects;


// --- Globals



var ADMIN_NET;
var MORAY;
var NAPI;
var NET;
var NET2;
var NET3;
var NET4;
var NET5;
var NET6;
var PROV_MAC_NET;


var BAD_STATE_ERRMSG = 'must be one of: "provisioning", "stopped", "running"';
var BAD_TYPE_ERRMSG = 'must be one of: "other", "server", "zone"';


// --- Setup



test('Initial setup', function (t) {
    h.reset();

    var num = h.NET_NUM;
    var netParams = h.validNetworkParams();

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

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, {
            name: netParams.nic_tag
        });
    });

    t.test('create nic_tag2', function (t2) {
        mod_nicTag.create(t2, {
            name: 'nic_tag2'
        });
    });

    t.test('create net', function (t2) {
        mod_net.create(t2, {
            params: netParams,
            partialExp: netParams
        }, function (_, res) {
            NET = res;
            NET.num = num;
            return t2.end();
        });
    });

    t.test('create net2', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams({
            routes: {
                '10.0.3.4': '10.0.2.2',
                '10.0.4.0/24': '10.0.2.2'
            },
            vlan_id: 46
        });

        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            NET2 = res;
            NET2.num = num;

            return t2.end();
        });
    });

    t.test('create net3', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams({ vlan_id: 47 });
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            NET3 = res;
            NET3.num = num;

            return t2.end();
        });
    });

    t.test('create net4', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams({
            vlan_id: NET2.vlan_id,
            nic_tag: NET2.nic_tag,
            subnet: NET2.subnet,
            provision_start_ip: NET2.provision_start_ip,
            provision_end_ip: NET2.provision_end_ip
        });
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            NET4 = res;
            NET4.num = num;

            t2.end();
        });
    });

    t.test('create net5', function (t2) {
        num = h.NET_NUM;
        var params = h.validIPv6NetworkParams({
            gateway: util.format('fd00:%s::e40e', num),
            vlan_id: 47
        });
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            NET5 = res;
            NET5.num = num;

            t2.end();
        });
    });

    t.test('create net6', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams();
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            NET6 = res;
            NET6.num = num;

            t2.end();
        });
    });

    t.test('create admin net', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams({ name: 'admin' });
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            ADMIN_NET = res;
            ADMIN_NET.num = num;

            return t2.end();
        });
    });

    t.test('create mac provision network', function (t2) {
        num = h.NET_NUM;
        var params = h.validNetworkParams();
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            PROV_MAC_NET = res;
            PROV_MAC_NET.num = num;

            return t2.end();
        });
    });
});



// --- Create tests



test('Create nic - missing params', function (t) {
    NAPI.post('/nics', {}, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                h.missingParam('belongs_to_type', 'Missing parameter'),
                h.missingParam('belongs_to_uuid', 'Missing parameter'),
                h.missingParam('owner_uuid', 'Missing parameter')
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic - missing params', function (t) {
    NAPI.provisionNic(NET.uuid, { }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                h.missingParam('belongs_to_type'),
                h.missingParam('belongs_to_uuid'),
                h.missingParam('owner_uuid')
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic - all invalid params', function (t) {
    var params = {
        allow_dhcp_spoofing: 'asdf',
        allow_ip_spoofing: 'asdf',
        allow_mac_spoofing: 'asdf',
        allow_restricted_traffic: 'asdf',
        allow_unfiltered_promisc: 'asdf',
        belongs_to_type: '',
        belongs_to_uuid: 'asdf',
        cn_uuid: 'asdf',
        ip: 'foo',
        mac: 'asdf',
        model: '',
        network_uuid: 'asdf',
        nic_tag: 'does_not_exist',
        nic_tags_provided: ['does', 'not', 'exist'],
        owner_uuid: 'invalid',
        primary: 'asdf',
        reserved: 'invalid',
        state: 'oogabooga',
        vlan_id: 'a'
    };

    NAPI.createNic('foobar', params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('allow_dhcp_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_ip_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_mac_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_restricted_traffic',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_unfiltered_promisc',
                    'must be a boolean value'),
                mod_err.invalidParam('belongs_to_type', BAD_TYPE_ERRMSG),
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                mod_err.invalidParam('cn_uuid', 'invalid UUID'),
                mod_err.invalidParam('ip', 'invalid IP address'),
                mod_err.invalidParam('mac', 'invalid MAC address'),
                mod_err.invalidParam('model', 'must not be empty'),
                mod_err.invalidParam('network_uuid', 'invalid UUID'),
                mod_err.invalidParam('nic_tag', 'nic tag does not exist'),
                {
                    code: 'InvalidParameter',
                    field: 'nic_tags_provided',
                    invalid: params.nic_tags_provided,
                    message: 'nic tags do not exist'
                },
                mod_err.invalidParam('owner_uuid', 'invalid UUID'),
                mod_err.invalidParam('primary', 'must be a boolean value'),
                mod_err.invalidParam('reserved', 'must be a boolean value'),
                mod_err.invalidParam('state', BAD_STATE_ERRMSG),
                mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic on network_uuid=admin', function (t) {
    var params = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic('admin', params, function (err, res) {
        t.ifError(err, 'create on admin: provisioned');
        if (err) {
            return t.end();
        }

        var exp = mod_nic.addDefaultParams({
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: res.ip,
            mac: res.mac,
            owner_uuid: params.owner_uuid,
            created_timestamp: res.created_timestamp,
            modified_timestamp: res.modified_timestamp
        }, ADMIN_NET);
        t.deepEqual(res, exp, 'create on admin: good response');

        NAPI.getNic(res.mac, function (err2, res2) {
            t.ifError(err2, 'create on admin: get success');
            t.deepEqual(res2, exp, 'create on admin: good get response');
            return t.end();
        });

    });
});


test('Create nic - invalid params (non-objects)', function (t) {
    vasync.forEachParallel({
        inputs: h.NON_OBJECT_PARAMS,
        func: function (data, cb) {
            NAPI.post({ path: '/nics' }, data, function (err) {
                t.ok(err, util.format('error returned: %s',
                    JSON.stringify(data)));
                if (!err) {
                    cb();
                    return;
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, {
                    code: 'InvalidParameters',
                    message: 'Invalid parameters',
                    errors: [
                        mod_err.invalidParam('parameters',
                            constants.msg.PARAMETERS_ARE_OBJECTS)
                    ]
                }, 'Error body');

                cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Create nic - invalid params', function (t) {
    var owner = mod_uuid.v4();
    var type = 'server';
    var uuid = mod_uuid.v4();

    var invalid = [
        [ 'IP address outside subnet',
            { ip: fmt('10.0.%d.1', NET.num + 1), belongs_to_type: type,
                belongs_to_uuid: uuid, owner_uuid: owner,
                network_uuid: NET.uuid },
                [ mod_err.invalidParam('ip', util.format(
                    constants.fmt.IP_OUTSIDE, fmt('10.0.%d.1', NET.num + 1),
                    NET.uuid)) ] ],

        [ 'IPv6 instead of IPv4 address in "ip" field',
            { ip: 'fd00::42', belongs_to_type: type,
                belongs_to_uuid: uuid, owner_uuid: owner,
                network_uuid: NET.uuid },
                [ mod_err.invalidParam('ip', constants.IPV4_REQUIRED) ] ],

        [ 'IP specified, but not nic_tag or vlan_id',
            { ip: '10.0.2.2', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner },
                [ h.missingParam('nic_tag', constants.msg.IP_NO_VLAN_TAG),
                h.missingParam('vlan_id', constants.msg.IP_NO_VLAN_TAG) ],
                'Missing parameters' ],

        [ 'IPv6 network in network_uuid',
            { ip: '10.0.2.2', belongs_to_type: type,
                belongs_to_uuid: uuid, owner_uuid: owner,
                network_uuid: NET5.uuid },
                [ mod_err.invalidParam('network_uuid', util.format(
                    constants.fmt.NET_BAD_AF, 'IPv4')) ] ],

        [ 'Non-existent network',
            { ip: '10.0.2.2', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: mod_uuid.v4() },
                [ mod_err.invalidParam('network_uuid',
                    'network does not exist') ] ],

        [ 'nic_tag and vlan_id present, IP outside subnet',
            { ip: fmt('10.0.%d.1', NET2.num + 1), belongs_to_type: type,
                belongs_to_uuid: uuid, nic_tag: NET2.nic_tag,
                owner_uuid: owner, vlan_id: NET2.vlan_id },
                [ mod_err.invalidParam('ip', util.format(
                    constants.fmt.IP_NONET, NET2.nic_tag, NET2.vlan_id,
                    fmt('10.0.%d.1', NET2.num + 1))) ] ],

        [ 'nic_tag and vlan_id do not match any networks',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                nic_tag: NET.nic_tag, owner_uuid: owner, vlan_id: 656 },
                [ mod_err.invalidParam('ip', util.format(
                    constants.fmt.IP_NONET, NET.nic_tag, 656, '10.0.2.3')) ] ],

        [ 'nic_tag and vlan_id present, IP matches multiple subnets',
            { ip: h.nextProvisionableIP(NET2, true), belongs_to_type: type,
                belongs_to_uuid: uuid, nic_tag: NET2.nic_tag,
                owner_uuid: owner, vlan_id: NET2.vlan_id },
                [ mod_err.invalidParam('ip', util.format(constants.fmt.IP_MULTI,
                    [ NET2.uuid, NET4.uuid ].sort().join(', '),
                    h.nextProvisionableIP(NET2, true))) ] ],

        [ 'vlan_id different between NIC parameters and network',
            { belongs_to_type: type, belongs_to_uuid: uuid, owner_uuid: owner,
                network_uuid: NET.uuid, vlan_id: 47 },
                [ mod_err.invalidParam('network_uuid', util.format(
                    constants.fmt.VLAN_IDS_DIFFER, 47, 0)) ] ],

        [ 'nic_tag different between NIC parameters and network',
            { belongs_to_type: type, belongs_to_uuid: uuid, owner_uuid: owner,
                network_uuid: NET.uuid, nic_tag: 'nic_tag2' },
                [ mod_err.invalidParam('network_uuid', util.format(
                    constants.fmt.NIC_TAGS_DIFFER, 'nic_tag2', 'nic_tag')) ] ],

        [ 'belongs_to_type must be a valid value',
            { ip: '10.0.2.3', belongs_to_type: 'router', belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, state: 'running' },
                [ mod_err.invalidParam('belongs_to_type', BAD_TYPE_ERRMSG) ] ],

        [ 'belongs_to_type must be a string',
            { ip: '10.0.2.3', belongs_to_type: true, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, state: 'running' },
                [ mod_err.invalidParam('belongs_to_type', BAD_TYPE_ERRMSG) ] ],

        [ 'nic_tag must be a string',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id, nic_tag: 4,
                state: 'running' },
                [ mod_err.invalidParam('nic_tag', constants.msg.STR) ] ],

        [ 'nic_tag must be a nonempty string',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id, nic_tag: '',
                state: 'running' },
                [ mod_err.invalidParam('nic_tag', 'must not be empty') ] ],

        [ 'nic_tag must not have more than one slash',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id, nic_tag: 'a/1/2',
                state: 'running' },
                [ mod_err.invalidParam('nic_tag',
                    constants.msg.NIC_TAG_SLASH) ] ],

        [ 'nic_tag must have a VNET ID following "/"',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id,
                nic_tag: NET2.nic_tag + '/', state: 'running' },
                [ mod_err.invalidParam('nic_tag',
                    constants.msg.VNET) ] ],

        [ 'nic_tag must contain a numeric VNET ID',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id,
                nic_tag: NET2.nic_tag + '/b', state: 'running' },
                [ mod_err.invalidParam('nic_tag', constants.msg.VNET) ] ],

        [ 'nic_tag must contain a VNET ID in the proper range',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id,
                nic_tag: NET2.nic_tag + '/-1', state: 'running' },
                [ mod_err.invalidParam('nic_tag', constants.msg.VNET) ] ],

        [ 'nic_tag must contain a VNET ID formatted in base 10',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id,
                nic_tag: NET2.nic_tag + '/0x1', state: 'running' },
                [ mod_err.invalidParam('nic_tag', constants.msg.VNET) ] ],

        [ 'nic_tag must contain an integer VNET ID',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, vlan_id: NET.vlan_id,
                nic_tag: NET2.nic_tag + '/1.2', state: 'running' },
                [ mod_err.invalidParam('nic_tag', constants.msg.VNET) ] ],

        [ 'state must be a valid value',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, state: 'deleted' },
                [ mod_err.invalidParam('state', BAD_STATE_ERRMSG) ] ],

        [ 'state must be a string',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, state: true },
                [ mod_err.invalidParam('state', BAD_STATE_ERRMSG) ] ]
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (data, cb) {
            NAPI.createNic(h.randomMAC(), data[1], function (err, res) {
                t.ok(err, 'error returned: ' + data[0]);
                if (!err) {
                    return cb();
                }

                t.deepEqual(err.body, h.invalidParamErr({
                    message: data[3] || 'Invalid parameters',
                    errors: data[2]
                }), 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Create nic - empty nic_tags_provided', function (t) {
    t.plan(9);
    var d = {
        ts: {}
    };

    t.test('create', function (t2) {
        var mac = h.randomMAC();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            nic_tags_provided: '',
            owner_uuid: mod_uuid.v4()
        };
        d.exp = mod_nic.addDefaultParams({
            mac: mac
        });
        h.copyParams(d.params, d.exp);
        delete d.exp.nic_tags_provided;

        mod_nic.createAndGet(t2, {
            mac: mac,
            params: d.params,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('create with same MAC', function (t2) {
        mod_nic.create(t2, {
            mac: d.exp.mac,
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid: mod_uuid.v4()
            },
            expErr: h.invalidParamErr({
                errors: [ mod_err.duplicateParam('mac') ]
            })
        });
    });

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, {
            name: 'tag52'
        });
    });

    t.test('set nic_tags_provided', function (t2) {
        var params = {
            nic_tags_provided: [ 'tag52' ]
        };
        h.copyParams(params, d.exp);

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: params,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('search for nic_tags_provided=tag52', function (t2) {
        mod_nic.list(t2, {
            params: {
                nic_tags_provided: [ 'tag52' ]
            },
            deepEqual: true,
            present: [ d.exp ]
        });
    });

    t.test('unset nic_tags_provided', function (t2) {
        delete d.exp.nic_tags_provided;

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: {
                nic_tags_provided: [ ]
            },
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('moray: after update', function (t2) {
        mod_moray.getNic(MORAY, d.exp.mac, function (err, mNic) {
            t2.ifError(err, 'Should get the NIC successfully');
            t2.ok(!mNic.hasOwnProperty('nic_tags_provided'),
                'nic_tags_provided unset on moray object');
            t2.end();
        });
    });

    t.test('set nic_tags_provided again', function (t2) {
        var params = {
            nic_tags_provided: [ 'tag52' ]
        };
        h.copyParams(params, d.exp);

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: params,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('unset nic_tags_provided with string', function (t2) {
        delete d.exp.nic_tags_provided;

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: {
                nic_tags_provided: ''
            },
            exp: d.exp,
            ts: d.ts
        });
    });
});


test('Create nic with resolver IP', function (t) {
    t.plan(2);
    var d = {};

    t.test('create net', function (t2) {
        var params = h.validNetworkParams();
        params.resolvers = [
            util_ip.ntoa(util_ip.aton(params.provision_start_ip) + 3) ];

        mod_net.create(t2, {
            params: params,
            partialExp: params,
            state: d
        });
    });

    t.test('create', function (t2) {
        var net = mod_net.lastCreated();
        t2.ok(net, 'network created');

        d.partialExp = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: net.resolvers[0],
            network_uuid: net.uuid,
            owner_uuid: mod_uuid.v4()
        };

        d.mac = h.randomMAC();
        mod_nic.createAndGet(t2, {
            mac: d.mac,
            params: d.partialExp,
            partialExp: d.partialExp
        });
    });
});



// --- Provision tests



test('Provision nic', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        if (h.ifErr(t, err, 'provision nic')) {
            return t.end();
        }

        var exp = {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: h.nextProvisionableIP(NET2),
            mac: res.mac,
            mtu: NET2.mtu,
            netmask: '255.255.255.0',
            network_uuid: NET2.uuid,
            nic_tag: NET2.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET2.resolvers,
            routes: NET2.routes,
            state: constants.DEFAULT_NIC_STATE,
            vlan_id: NET2.vlan_id,
            created_timestamp: res.created_timestamp,
            modified_timestamp: res.modified_timestamp
        };
        t.deepEqual(res, exp, 'result');
        t.equal(res.created_timestamp, res.modified_timestamp,
            'nic created and modified ts equal at creation');
        t.notEqual(res.created_timestamp, 0, 'nic created ts non-zero');


        NAPI.getNic(res.mac, function (err2, res2) {
            if (h.ifErr(t, err2, 'get provisioned nic')) {
                return t.end();
            }

            t.deepEqual(res2, exp, 'get result');

            NAPI.get({ path: '/nics/' + res.mac }, function (err3, res3) {
                t.ifError(err3, 'get NIC with colons in MAC address');
                t.deepEqual(res3, exp, 'get result');
                t.end();
            });
        });
    });
});


test('Provision nic: exceed MAC retries', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };
    var numNicsBefore;

    t.test('Get count of NICs before', function (t2) {
        mod_moray.countNics(MORAY, function (err, count) {
            t2.ifError(err, 'Count should succeed');
            numNicsBefore = count;
            t2.end();
        });
    });

    t.test('Provision new NIC', function (t2) {
        var errs = [ ];
        for (var i = 0; i < constants.MAC_RETRIES + 1; i++) {
            var fakeErr = new Error('Already exists');
            fakeErr.name = 'EtagConflictError';
            fakeErr.context = { bucket: models.nic.bucket().name };
            errs.push(fakeErr);
        }
        MORAY.setMockErrors({ batch: errs });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err) {
            t2.ok(err, 'error returned');
            if (!err) {
                t2.end();
                return;
            }

            t2.equal(err.statusCode, 500, 'status code');
            t2.deepEqual(err.body, {
                code: 'InternalError',
                message: 'no more free MAC addresses'
            }, 'Error body');

            t2.end();
        });
    });

    t.test('Confirm that the IP is free', function (t2) {
        NAPI.getIP(PROV_MAC_NET.uuid, PROV_MAC_NET.provision_start_ip,
            function (err2, res) {
            if (h.ifErr(t2, err2, 'getIP error')) {
                t2.end();
                return;
            }

            t2.equal(res.free, true, 'IP has been freed');
            mod_moray.getIP(MORAY, PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip, function (err3, ipRec) {
                t2.ok(err3, 'Getting IP should fail');
                t2.ok(!ipRec, 'IP record does not exist in moray');

                mod_moray.countNics(MORAY, function (err4, numNicsAfter) {
                    t2.ifError(err4, 'Count should succeed');
                    t2.equal(numNicsAfter, numNicsBefore,
                        'no new nic records added');

                    // Make sure we actually hit all of the errors:
                    t2.deepEqual(MORAY.getMockErrors(), {
                        batch: [ ]
                    }, 'no more batch errors left');

                    t2.end();
                });
            });
        });
    });
});


test('Provision nic: exceed IP retries', function (t) {
    var numNicsBefore;
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var startIP = h.nextProvisionableIP(PROV_MAC_NET, true);
    var range = [];
    for (var i = 0; i < constants.IP_PROVISION_GAP_LENGTH; i++) {
        range.push(util_ip.ipAddrPlus(util_ip.toIPAddr(startIP), i).toString());
    }

    var ips = [];
    var dlen = constants.IP_PROVISION_RETRIES + 1;
    while (ips.length !== dlen) {
        ips = ips.concat(range.slice(0, dlen - ips.length));
    }

    t.test('Count NICs before provision attempt', function (t2) {
        mod_moray.countNics(MORAY, function (err, count) {
            t2.ifError(err, 'Count should succeed');
            numNicsBefore = count;
            t2.end();
        });
    });

    t.test('Attempt NIC provision', function (t2) {
        var errs = ips.map(function (curr) {
            var fakeErr = new Error('Already exists');
            fakeErr.name = 'EtagConflictError';
            fakeErr.context = {
                bucket: ip_common.bucketName(PROV_MAC_NET.uuid),
                key: curr
            };
            return fakeErr;
        });
        MORAY.setMockErrors({ batch: errs });

        mod_nic.provision(t2, {
            net: PROV_MAC_NET.uuid,
            params: params,
            expCode: 507,
            expErr: {
                code: 'SubnetFull',
                message: constants.SUBNET_FULL_MSG,
                network_uuid: PROV_MAC_NET.uuid
            }
        });
    });

    t.test('No new NICs created', function (t2) {
        // Make sure we actually hit all of the errors:
        t2.deepEqual(MORAY.getMockErrors(), {
            batch: [ ]
        }, 'no more batch errors left');

        // Reset in case we didn't hit everything:
        MORAY.setMockErrors({ });

        mod_moray.countNics(MORAY, function (err4, numNicsAfter) {
            t2.ifError(err4, 'Counting NICs should succeed');
            t2.equal(numNicsAfter, numNicsBefore,
                'no new nic records added');
            t2.end();
        });
    });

    function checkIP(t2, barrier, ip) {
        var prefix = ip + ': ';

        barrier.start(ip);

        NAPI.getIP(PROV_MAC_NET.uuid, ip, function (err2, res) {
            if (h.ifErr(t2, err2, prefix + 'getIP error')) {
                t2.end();
                return;
            }

            t2.equal(res.free, true, prefix + 'IP has been freed');
            mod_moray.getIP(MORAY, PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip, function (err3, ipRec) {
                t2.ok(err3, prefix + 'Getting IP should fail');
                t2.ok(!ipRec, prefix + 'IP record does not exist in moray');

                barrier.done(ip);
            });
        });
    }

    t.test('Confirm that unused IPs are free', function (t2) {
        var barrier = vasync.barrier();

        range.forEach(function (ip) {
            checkIP(t2, barrier, ip);
        });

        barrier.on('drain', function () {
            t2.end();
        });
    });
});


test('Provision NIC w/ IP: IP taken during provision', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4(),
        ip: h.nextProvisionableIP(PROV_MAC_NET, true)
    };
    var numNicsBefore;

    t.test('Count NICs before provision attempt', function (t2) {
        mod_moray.countNics(MORAY, function (err, count) {
            t2.ifError(err, 'Count should succeed');
            numNicsBefore = count;
            t2.end();
        });
    });

    t.test('Attempt NIC provision', function (t2) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = {
            bucket: ip_common.bucketName(PROV_MAC_NET.uuid),
            key: params.ip
        };
        MORAY.setMockErrors({ batch: [ fakeErr ] });

        mod_nic.provision(t2, {
            net: PROV_MAC_NET.uuid,
            params: params,
            expCode: 422,
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.duplicateParam('ip', fmt(constants.fmt.IP_EXISTS,
                        params.ip, PROV_MAC_NET.uuid))
                ]
            })
        });
    });

    t.test('Confirm that the IP is free', function (t2) {
        // Make sure we actually hit all of the errors:
        t2.deepEqual(MORAY.getMockErrors(), {
            batch: [ ]
        }, 'no more batch errors left');

        mod_ip.get(t2, {
            net: PROV_MAC_NET.uuid,
            ip: params.ip,
            exp: {
                free: true,
                ip: params.ip,
                network_uuid: PROV_MAC_NET.uuid,
                reserved: false
            }
        });
    });

    t.test('Confirm no new records created', function (t2) {
        mod_moray.getIP(MORAY, PROV_MAC_NET.uuid, params.ip,
            function (err3, ipRec) {
            t2.ok(err3, 'Getting IP should fail');
            t2.ok(!ipRec, 'IP record does not exist in moray');

            mod_moray.countNics(MORAY, function (err4, numNicsAfter) {
                t2.ifError(err4, 'Counting NICs should succeed');
                t2.equal(numNicsAfter, numNicsBefore,
                    'no new nic records added');

                t2.end();
            });

        });
    });
});


test('Provision nic: MAC retry', function (t) {
    t.plan(4);
    var d = {};

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: models.nic.bucket().name };

        MORAY.setMockErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic with retry')) {
                return t2.end();
            }

            d.mac = res.mac;
            t2.ok(res.mac, 'MAC address');

            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Should get NIC successfully');
                t2.ok(morayObj, 'found moray object');
                if (morayObj) {
                    t2.equal(morayObj.mac, mod_mac.parse(res.mac).toLong(),
                        'correct mac in moray object');
                }

                t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                    'network_uuid correct');

                // Make sure we actually hit those errors:
                t2.deepEqual(MORAY.getMockErrors(), {
                    batch: [ ]
                }, 'no more batch errors left');

                d.created_timestamp = morayObj.created_timestamp;
                d.modified_timestamp = morayObj.modified_timestamp;
                t2.equal(morayObj.created_timestamp,
                    morayObj.modified_timestamp,
                    'nic created and modified ts equal at creation');
                t2.notEqual(res.created_timestamp, 0,
                    'nic created ts non-zero');

                t2.end();
            });
        });
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
        });
    });

    t.test('create', function (t2) {
        d = {
            mac: h.randomMAC()
        };
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            network_uuid: PROV_MAC_NET.uuid,
            owner_uuid: mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: models.nic.bucket().name };

        MORAY.setMockErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            expErr: h.invalidParamErr({
                    errors: [ mod_err.duplicateParam('mac') ]
                })
        }, function () {
            mod_moray.getNic(MORAY, d.mac, function (err, morayObj) {
                t2.ok(err, 'Get should fail');
                t2.equal(morayObj, undefined, 'moray object does not exist');

                // We should have bailed after the first iteration of the loop:
                t2.equal(MORAY.getMockErrors().batch.length, 1,
                    'one error left');

                // Reset moray errors
                MORAY.setMockErrors({ });

                t2.end();
            });
        });
    });

    t.test('get created', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('Provision nic: IP retry', function (t) {
    t.plan(4);
    var d = {
        ts: {}
    };

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        MORAY.setMockErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic with retry')) {
                return t2.end();
            }

            d.mac = res.mac;
            t2.ok(res.mac, 'MAC address');

            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Get should succeed');
                t2.ok(morayObj, 'found moray object');
                if (morayObj) {
                    t2.equal(morayObj.mac, mod_mac.parse(res.mac).toLong(),
                        'correct mac in moray object');
                }

                t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                    'network_uuid correct');
                t2.equal(res.created_timestamp, res.modified_timestamp,
                    'nic created and modified ts equal at creation');
                t2.notEqual(res.created_timestamp, 0,
                    'nic created ts non-zero');

                d.ts.created_timestamp = res.created_timestamp;
                d.ts.modified_timestamp = res.modified_timestamp;

                // Make sure we actually hit those errors:
                t2.deepEqual(MORAY.getMockErrors(), {
                    batch: [ ]
                }, 'no more batch errors left');

                t2.end();
            });
        });
    });

    t.test('get provisioned', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            },
            ts: d.ts
        });
    });

    // Try the same again with a specified MAC, not a randomly-generated one

    t.test('create', function (t2) {
        d = {
            mac: h.randomMAC()
        };
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            network_uuid: PROV_MAC_NET.uuid,
            owner_uuid: mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        MORAY.setMockErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            partialExp: params,
            ts: d.ts
        }, function (err, res) {
            if (h.ifErr(t2, err, 'Create should succeed')) {
                t2.end();
                return;
            }

            t2.ok(res.mac, 'MAC address');
            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Get should succeed');
                t2.ok(morayObj, 'found moray object');
                if (morayObj) {
                    t2.equal(morayObj.mac, mod_mac.parse(res.mac).toLong(),
                        'correct mac in moray object');
                }

                t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                    'network_uuid correct');

                // Make sure we actually hit those errors:
                t2.deepEqual(MORAY.getMockErrors(), {
                    batch: [ ]
                }, 'no more batch errors left');

                t2.end();
            });
        });
    });

    t.test('get created', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            },
            ts: d.ts
        });
    });
});


test('Provision NIC: Retry after QueryTimeoutErrors', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    t.test('NIC provision', function (t2) {
        var fakeErr = new Error('Timed out');
        fakeErr.name = 'QueryTimeoutError';

        /*
         * The sql() error will prevent NAPI from selecting an IP from
         * the first network in the pool. It will then retry, and fail
         * to submit with batch(). After these errors, it will still
         * use the originally selected IP, since it didn't actually need
         * to change.
         */
        MORAY.setMockErrors({
            sql: [ fakeErr ],
            batch: [ fakeErr, fakeErr, fakeErr ]
        });

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            exp: mod_nic.addDefaultParams({
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                owner_uuid: params.owner_uuid,
                ip: h.nextProvisionableIP(NET2)
            }, NET2)
        });
    });

    t.test('Confirm that NAPI hit the errors', function (t2) {
        // Make sure we actually hit all of the errors:
        t2.deepEqual(MORAY.getMockErrors(), {
            sql: [ ],
            batch: [ ]
        }, 'no more batch errors left');
        t2.end();
    });
});


test('Provision many NICs concurrently - same network', function (t) {
    var barrier = vasync.barrier();
    var concurrency = 100;

    function createNIC(n) {
        var name = 'nic-prov-' + n;
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        barrier.start(name);

        mod_nic.provision(t, {
            net: NET6.uuid,
            params: params,
            partialExp: params
        }, function () {
            barrier.done(name);
        });
    }

    for (var i = 0; i < concurrency; ++i) {
        createNIC(i);
    }

    barrier.on('drain', function () {
        t.end();
    });
});


test('Provision nic - with IP', function (t) {
    t.plan(7);
    var d = {};

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: fmt('10.0.%d.200', NET2.num),
            owner_uuid: mod_uuid.v4()
        };

        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic')) {
                return t2.end();
            }

            t2.equal(res.created_timestamp, res.modified_timestamp,
                'nic created and modified ts equal at creation');
            t2.notEqual(res.created_timestamp, 0, 'nic created ts non-zero');

            d.exp = mod_nic.addDefaultParams({
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: fmt('10.0.%d.200', NET2.num),
                mac: res.mac,
                owner_uuid: params.owner_uuid,
                created_timestamp: res.created_timestamp,
                modified_timestamp: res.modified_timestamp
            }, NET2);
            t2.deepEqual(res, d.exp, 'result');
            return t2.end();
        });
    });

    t.test('get', function (t2) {
        if (!d.exp) {
            return t2.end();
        }

        NAPI.getNic(d.exp.mac, function (err, res) {
            if (h.ifErr(t2, err, 'get nic')) {
                return t2.end();
            }

            t2.deepEqual(res, d.exp, 'result');
            return t2.end();
        });
    });

    t.test('provision with duplicate IP', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: fmt('10.0.%d.200', NET2.num),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', d.exp.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', d.exp.belongs_to_uuid))
                ]
            })
        });
    });

    // Try updating another nic to have that IP - it should fail

    t.test('create second nic', function (t2) {
        d.mac = h.randomMAC();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.create(t2, {
            mac: d.mac,
            params: d.params,
            partialExp: d.params
        });
    });

    t.test('update second nic', function (t2) {
        mod_nic.update(t2, {
            mac: d.mac,
            params: {
                ip: fmt('10.0.%d.200', NET2.num),
                network_uuid: NET2.uuid
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', d.exp.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', d.exp.belongs_to_uuid))
                ]
            })
        });
    });

    // Try updating a nic with a different IP to have that IP

    t.test('create third nic', function (t2) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        d.exp3 = {
            ip: h.nextProvisionableIP(NET2)
        };
        h.copyParams(d.params, d.exp3);

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: d.params,
            partialExp: d.exp3,
            // This will put the nic in d.nics[0]
            state: d
        });
    });

    t.test('update third nic', function (t2) {
        mod_nic.update(t2, {
            mac: d.nics[0].mac,
            params: {
                ip: fmt('10.0.%d.200', NET2.num),
                network_uuid: NET2.uuid
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', d.exp.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', d.exp.belongs_to_uuid))
                ]
            })
        });
    });
});


test('(PNDS) Provision nic - with different state', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4(),
        state: 'stopped'
    };
    var exp = mod_nic.addDefaultParams({
        belongs_to_type: params.belongs_to_type,
        belongs_to_uuid: params.belongs_to_uuid,
        ip: h.nextProvisionableIP(NET2),
        owner_uuid: params.owner_uuid,
        state: 'stopped'
    }, NET2);
    var ts = {};

    t.test('(PNDS) provision', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NET2.uuid,
            params: params,
            exp: exp,
            ts: ts
        });
    });

    t.test('(PNDS) get nic', function (t2) {
        mod_nic.get(t2, {
            mac: exp.mac,
            exp: exp,
            ts: ts
        });
    });

    t.test('(PNDS) update state', function (t2) {
        exp.state = 'running';

        mod_nic.updateAndGet(t2, {
            mac: exp.mac,
            params: {
                state: 'running'
            },
            exp: exp,
            ts: ts
        });
    });
});


test('Provision NIC - IP specified w/o network_uuid', function (t) {
    var mac1 = h.randomMAC();
    var mac2 = h.randomMAC();
    var base = {
        belongs_to_type: 'zone',
        owner_uuid: mod_uuid.v4(),
        ip: h.nextProvisionableIP(NET3),
        vlan_id: NET3.vlan_id,
        nic_tag: NET3.nic_tag
    };
    var params1 = extend(base, { belongs_to_uuid: mod_uuid.v4() });
    var params2 = extend(base, { belongs_to_uuid: mod_uuid.v4() });

    t.test('create', function (t2) {
        mod_nic.createAndGet(t2, {
            mac: mac1,
            params: params1,
            partialExp: extend(params1, {
                network_uuid: NET3.uuid
            })
        });
    });

    t.test('get IPv4 address', function (t2) {
        mod_ip.get(t2, {
            net: NET3.uuid,
            ip: params1.ip,
            exp: {
                belongs_to_type: params1.belongs_to_type,
                belongs_to_uuid: params1.belongs_to_uuid,
                owner_uuid: params1.owner_uuid,
                ip: params1.ip,
                network_uuid: NET3.uuid,
                free: false,
                reserved: false
            }
        });
    });

    t.test('another NIC cannot steal the IP', function (t2) {
        mod_nic.create(t2, {
            mac: mac2,
            params: params2,
            expCode: 422,
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', params1.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', params1.belongs_to_uuid))
                ]
            })
        });
    });
});





// --- Get tests



test('Get NIC with bad MAC address', function (t) {
    mod_nic.get(t, {
        mac: 'foo',
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('mac', 'invalid MAC address') ]
        })
    });
});


test('Get NIC with different ways of writing MAC address', function (t) {
    var exp;

    t.plan(5);

    t.test('Create NIC without leading zeros', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.create(t2, {
            mac: 'a:b:c:d:e:f',
            params: params,
            partialExp: params
        }, function (_, res) {
            if (res) {
                t2.equal(res.mac, '0a:0b:0c:0d:0e:0f',
                    'normalized MAC address');
                exp = res;
            }

            t2.end();
        });
    });

    t.test('Get NIC with no separators', function (t2) {
        NAPI.get({ path: '/nics/0a0b0c0d0e0f' }, function (err, res) {
            t2.ifError(err, 'get NIC with colons in MAC address');
            t2.deepEqual(res, exp, 'get result');
            t2.end();
        });
    });

    t.test('Get NIC with ":" separator', function (t2) {
        NAPI.get({ path: '/nics/0a:0b:0c:0d:0e:0f' }, function (err, res) {
            t2.ifError(err, 'get NIC with colons in MAC address');
            t2.deepEqual(res, exp, 'get result');
            t2.end();
        });
    });

    t.test('Get NIC with "-" separator', function (t2) {
        NAPI.get({ path: '/nics/0a-0b-0c-0d-0e-0f' }, function (err, res) {
            t2.ifError(err, 'get NIC with colons in MAC address');
            t2.deepEqual(res, exp, 'get result');
            t2.end();
        });
    });

    t.test('Get NIC with no leading zeros', function (t2) {
        NAPI.get({ path: '/nics/a:b:c:d:e:f' }, function (err, res) {
            t2.ifError(err, 'get NIC with colons in MAC address');
            t2.deepEqual(res, exp, 'get result');
            t2.end();
        });
    });
});


// --- Delete tests



test('Delete NIC with bad MAC address', function (t) {
    mod_nic.del(t, {
        mac: 'foo',
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('mac', 'invalid MAC address') ]
        })
    });
});


test('Delete a nonexistent NIC', function (t) {
    mod_nic.del(t, {
        mac: h.randomMAC(),
        expCode: 404,
        expErr: {
            code: 'ResourceNotFound',
            message: 'nic not found'
        }
    });
});


test('Delete a NIC w/o any addresses on it', function (t) {
    var nic;
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    t.test('provision', function (t2) {
        NAPI.post({ path: '/nics' }, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision new nic')) {
                t2.end();
                return;
            }

            nic = res;
            for (var p in params) {
                t2.equal(nic[p], params[p], p + ' correct');
            }

            t2.notOk(res.hasOwnProperty('ip'), 'NIC has no IP');

            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        mod_nic.del(t2, { mac: nic.mac });
    });

    t.test('confirm nic deleted', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('Delete a NIC w/ an address on it', function (t) {
    var nic;
    var ip = h.nextProvisionableIP(NET2);
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    t.test('provision', function (t2) {
        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provision nic')) {
                t.end();
                return;
            }

            nic = mod_nic.addDefaultParams({
                mac: res.mac,
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: ip,
                owner_uuid: params.owner_uuid,
                state: 'provisioning',
                created_timestamp: res.created_timestamp,
                modified_timestamp: res.modified_timestamp
            }, NET2);

            t.deepEqual(res, nic, 'result');

            mod_nic.get(t2, {
                mac: res.mac,
                exp: nic
            });
        });
    });

    t.test('check that ip is taken', function (t2) {
        mod_ip.get(t2, {
            net: NET2.uuid,
            ip: ip,
            exp: {
                belongs_to_type: nic.belongs_to_type,
                belongs_to_uuid: nic.belongs_to_uuid,
                free: false,
                ip: ip,
                network_uuid: NET2.uuid,
                owner_uuid: nic.owner_uuid,
                reserved: false
            }
        });
    });

    t.test('delete nic', function (t2) {
        mod_nic.del(t2, { mac: nic.mac });
    });

    t.test('confirm nic deleted', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });

    t.test('check that ip is now free', function (t2) {
        mod_ip.get(t2, {
            net: NET2.uuid,
            ip: ip,
            exp: {
                free: true,
                ip: ip,
                network_uuid: NET2.uuid,
                reserved: false
            }
        });
    });
});


test('NAPI-267: Networks referenced by NICs cannot be deleted', function (t) {
    var net, nic;

    t.test('Create network', function (t2) {
        var params = h.validNetworkParams();

        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (_, res) {
            net = res;
            t2.end();
        });
    });

    t.test('Create NIC', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t2, {
            net: net.uuid,
            params: params,
            partialExp: params
        }, function (_, res) {
            nic = res;
            t2.end();
        });
    });

    t.test('Attempt to delete network', function (t2) {
        var err = new mod_err.InUseError(constants.msg.NIC_ON_NET,
            [ mod_err.usedBy('nic', nic.mac) ]);

        mod_net.del(t2, {
            uuid: net.uuid,
            expCode: 422,
            expErr: err.body
        });
    });
});


// --- Update tests



test('Update nic - provision IP', function (t) {
    t.plan(4);
    var d = {};

    t.test('create', function (t2) {
        d.mac = h.randomMAC();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };
        d.ts = {};

        mod_nic.create(t2, {
            mac: d.mac,
            params: d.params,
            partialExp: d.params,
            ts: d.ts
        });

    });

    t.test('update', function (t2) {
        d.exp = mod_nic.addDefaultParams({
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: h.nextProvisionableIP(NET3),
            mac: d.mac,
            owner_uuid: d.params.owner_uuid
        }, NET3);

        mod_nic.update(t2, {
            mac: d.mac,
            params: {
                network_uuid: NET3.uuid
            },
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get nic', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get IPv4 address', function (t2) {
        mod_ip.get(t2, {
            net: NET3.uuid,
            ip: d.exp.ip,
            exp: {
                belongs_to_type: d.exp.belongs_to_type,
                belongs_to_uuid: d.exp.belongs_to_uuid,
                free: false,
                ip: d.exp.ip,
                network_uuid: NET3.uuid,
                owner_uuid: d.exp.owner_uuid,
                reserved: false
            }
        });
    });
});


test('Update nic - IP parameters updated', function (t) {
    t.plan(5);
    var d = {};

    t.test('create', function (t2) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: '10.0.2.188',
            network_uuid: NET.uuid,
            owner_uuid: mod_uuid.v4()
        };
        d.mac = h.randomMAC();
        d.exp = mod_nic.addDefaultParams({
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: d.params.ip,
            mac: d.mac,
            owner_uuid: d.params.owner_uuid
        }, NET);
        d.ts = {};

        mod_nic.create(t2, {
            mac: d.mac,
            params: d.params,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get after create', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('update', function (t2) {
        var updateParams = {
            belongs_to_type: 'other',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        h.copyParams(updateParams, d.exp);

        mod_nic.update(t2, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get after update', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get IP', function (t2) {
        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.exp.ip,
            exp: {
                belongs_to_type: d.exp.belongs_to_type,
                belongs_to_uuid: d.exp.belongs_to_uuid,
                free: false,
                ip: d.exp.ip,
                network_uuid: NET.uuid,
                owner_uuid: d.exp.owner_uuid,
                reserved: false
            }
        });
    });
});


test('Update nic - change IP', function (t) {
    t.plan(13);
    var d = {};

    t.test('create', function (t2) {
        d.ips = [ '10.0.2.196', '10.0.2.197', '10.0.2.198' ];
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: d.ips[0],
            network_uuid: NET.uuid,
            owner_uuid: mod_uuid.v4()
        };

        d.mac = h.randomMAC();
        d.exp = mod_nic.addDefaultParams({
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: params.ip,
            mac: d.mac,
            owner_uuid: params.owner_uuid
        }, NET);
        d.other = mod_uuid.v4();
        d.ts = {};

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('update: add IP', function (t2) {
        var updateParams = {
            ip: d.ips[1],
            network_uuid: NET.uuid
        };

        for (var k in updateParams) {
            d.exp[k] = updateParams[k];
        }

        mod_nic.update(t2, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get: after first update', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get old IP', function (t2) {
        d.expIPs = [
            {
                free: true,
                ip: d.ips[0],
                network_uuid: NET.uuid,
                reserved: false
            }
        ];

        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[0],
            exp: d.expIPs[0]
        });
    });

    t.test('get new IP', function (t2) {
        d.expIPs.push({
            belongs_to_type: d.exp.belongs_to_type,
            belongs_to_uuid: d.exp.belongs_to_uuid,
            free: false,
            ip: d.ips[1],
            network_uuid: NET.uuid,
            owner_uuid: d.exp.owner_uuid,
            reserved: false
        });

        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    });

    // Reserve ips[2] so that it exists in moray
    t.test('reserve ip 2', function (t2) {
        d.expIPs.push({
            free: false,
            ip: d.ips[2],
            network_uuid: NET.uuid,
            reserved: true
        });

        mod_ip.update(t2, {
            net: NET.uuid,
            ip: d.ips[2],
            exp: d.expIPs[2],
            params: {
                reserved: true
            }
        });
    });

    // Change belongs_to_uuid of ips[1]: the next update should leave it
    // alone, since the nic no longer owns it
    t.test('change ip 1 belongs_to_uuid', function (t2) {
        d.expIPs[1].belongs_to_uuid = d.other;

        mod_ip.update(t2, {
            net: NET.uuid,
            ip: d.ips[1],
            params: {
                belongs_to_uuid: d.other
            },
            exp: d.expIPs[1]
        });
    });

    // confirm the change
    t.test('get ip 1 after update', function (t2) {
        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    });

    // Now update the nic so that it points to ip2
    t.test('update nic to ip2', function (t2) {
        var updateParams = {
            ip: d.ips[2],
            network_uuid: NET.uuid
        };

        h.copyParams(updateParams, d.exp);
        mod_nic.update(t2, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('get: after update to ip2', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('ip0 unchanged', function (t2) {
        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[0],
            exp: d.expIPs[0]
        });
    });

    // ip1 should be unchanged as well, since it's no longer owned
    // by the nic we updated
    t.test('ip1 unchanged', function (t2) {
        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    });

    // And finally, ip2 should have the nic as its owner now and still have
    // reserved set to true
    t.test('ip2 unchanged', function (t2) {
        d.expIPs[2] = {
            belongs_to_type: d.exp.belongs_to_type,
            belongs_to_uuid: d.exp.belongs_to_uuid,
            free: false,
            ip: d.ips[2],
            network_uuid: NET.uuid,
            owner_uuid: d.exp.owner_uuid,
            reserved: true
        };

        mod_ip.get(t2, {
            net: NET.uuid,
            ip: d.ips[2],
            exp: d.expIPs[2]
        });
    });
});


test('Update nic - add resolver IP', function (t) {
    t.plan(3);
    var d = {};

    t.test('create net', function (t2) {
        var params = h.validNetworkParams();
        params.resolvers = [
            util_ip.ntoa(util_ip.aton(params.provision_start_ip) + 3) ];

        mod_net.create(t2, {
            params: params,
            partialExp: params,
            state: d
        });
    });

    d.ts = {};

    t.test('create', function (t2) {
        d.partialExp = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        d.mac = h.randomMAC();
        mod_nic.create(t2, {
            mac: d.mac,
            params: d.partialExp,
            partialExp: d.partialExp,
            ts: d.ts
        });
    });

    t.test('update: add IP', function (t2) {
        d.net = d.networks[0];
        var updateParams = {
            ip: d.net.resolvers[0],
            network_uuid: d.net.uuid
        };

        for (var k in updateParams) {
            d.partialExp[k] = updateParams[k];
        }

        mod_nic.updateAndGet(t2, {
            mac: d.mac,
            params: updateParams,
            partialExp: d.partialExp,
            ts: d.ts
        });
    });
});


test('Update nic - all invalid params', function (t) {
    var mac = h.randomMAC();
    var goodParams = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var badParams = {
        belongs_to_type: '',
        belongs_to_uuid: 'asdf',
        ip: 'foo',
        mac: 'asdf',
        model: '',
        network_uuid: 'asdf',
        nic_tag: 'does_not_exist',
        nic_tags_provided: ['does', 'not', 'exist'],
        owner_uuid: 'invalid',
        primary: 'invalid',
        reserved: 'invalid',
        state: 'oogabooga',
        vlan_id: 'a'
    };

    NAPI.createNic(mac, goodParams, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.end();
        }

        NAPI.updateNic(mac, badParams, function (err2, res2) {
            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [
                    mod_err.invalidParam('belongs_to_type', BAD_TYPE_ERRMSG),
                    mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                    mod_err.invalidParam('ip', 'invalid IP address'),
                    mod_err.invalidParam('model', 'must not be empty'),
                    mod_err.invalidParam('network_uuid', 'invalid UUID'),
                    mod_err.invalidParam('nic_tag', 'nic tag does not exist'),
                    {
                        code: 'InvalidParameter',
                        field: 'nic_tags_provided',
                        invalid: badParams.nic_tags_provided,
                        message: 'nic tags do not exist'
                    },
                    mod_err.invalidParam('owner_uuid', 'invalid UUID'),
                    mod_err.invalidParam('primary', 'must be a boolean value'),
                    mod_err.invalidParam('reserved', 'must be a boolean value'),
                    mod_err.invalidParam('state', BAD_STATE_ERRMSG),
                    mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
                ]
            }), 'Error body');

            return t.end();
        });

    });
});


test('Update nic - invalid params', function (t) {
    var mac = h.randomMAC();
    var goodParams = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var invalid = [
        [ 'IP address outside subnet',
            { ip: '10.0.3.1', network_uuid: NET.uuid },
            [ mod_err.invalidParam('ip', util.format(
                constants.fmt.IP_OUTSIDE, '10.0.3.1', NET.uuid)) ] ],

        [ 'IP specified, but not nic_tag or vlan_id',
            { ip: '10.0.2.2' },
            [ h.missingParam('nic_tag',
                'required if IP specified but not network_uuid'),
            h.missingParam('vlan_id',
                'required if IP specified but not network_uuid') ],
            'Missing parameters' ],

        [ 'Non-existent network',
            { ip: '10.0.2.2', network_uuid: mod_uuid.v4() },
            [ mod_err.invalidParam('network_uuid',
                'network does not exist') ] ],

        [ 'nic_tag and vlan_id present, IP outside subnet',
            { ip: fmt('10.0.%d.1', NET2.num + 1), nic_tag: NET2.nic_tag,
                vlan_id: NET2.vlan_id },
            [ mod_err.invalidParam('ip', util.format(
                constants.fmt.IP_NONET, NET2.nic_tag, NET2.vlan_id,
                fmt('10.0.%d.1', NET2.num + 1))) ] ],

        [ 'nic_tag and vlan_id do not match any networks',
            { ip: fmt('10.0.%d.3', NET.num), nic_tag: NET.nic_tag,
                vlan_id: 656 },
            [ mod_err.invalidParam('ip', util.format(
                constants.fmt.IP_NONET, NET.nic_tag, 656,
                fmt('10.0.%d.3', NET.num))) ] ],

        [ 'state must be a valid state',
            { ip: fmt('10.0.%d.2', NET.num), network_uuid: NET.uuid,
                state: 'oogabooga' },
            [ mod_err.invalidParam('state', BAD_STATE_ERRMSG) ] ]
    ];

    NAPI.createNic(mac, goodParams, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.end();
        }

        vasync.forEachParallel({
            inputs: invalid,
            func: function (data, cb) {
                NAPI.updateNic(mac, data[1], function (err2, res2) {
                    t.ok(err2, 'error returned: ' + data[0]);
                    if (!err2) {
                        return cb();
                    }

                    t.equal(err2.statusCode, 422, 'status code');
                    t.deepEqual(err2.body, h.invalidParamErr({
                        message: data[3] || 'Invalid parameters',
                        errors: data[2]
                    }), 'Error body');

                    return cb();
                });
            }
        }, function () {
            return t.end();
        });
    });
});


// Test updates that should cause no changes to the nic object
test('Update nic - no changes', function (t) {
    t.plan(8);
    var d = {};
    var ts = {};

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        var partialExp = {
            ip: h.nextProvisionableIP(NET2),
            network_uuid: NET2.uuid
        };
        h.copyParams(params, partialExp);

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            state: d,
            partialExp: partialExp,
            ts: ts
        });
    });

    t.test('update with same params', function (t2) {
        delete d.nics[0].modified_timestamp;

        mod_nic.update(t2, {
            mac: d.nics[0].mac,
            params: d.nics[0],
            exp: d.nics[0],
            // even though there is no effective change, for now
            // this should still bump modified_timestamp
            ts: ts
        });
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0],
            ts: ts
        });
    });

    // Update with only network_uuid set: this should not cause a new
    // IP to be provisioned for that nic
    t.test('update with network_uuid', function (t2) {
        mod_nic.update(t2, {
            mac: d.nics[0].mac,
            params: {
                network_uuid: NET3.uuid
            },
            exp: d.nics[0],
            ts: ts
        });
    });

    t.test('get after network_uuid', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0],
            ts: ts
        });
    });

    // Changing the MAC address should not be allowed
    t.test('update with mac', function (t2) {
        d.newMAC = h.randomMAC();
        mod_nic.update(t2, {
            mac: d.nics[0].mac,
            params: {
                mac: d.newMAC
            },
            exp: d.nics[0],
            ts: ts
        });
    });

    t.test('get after mac update', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0],
            ts: ts
        });
    });

    // That update should not have created a new nic object with the
    // new MAC
    t.test('get new MAC', function (t2) {
        mod_nic.get(t2, {
            mac: d.newMAC,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('Update nic - change state', function (t) {

    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var ts = {};

    t.test('provision', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: h.nextProvisionableIP(NET2),
                state: constants.DEFAULT_NIC_STATE
            }),
            ts: ts
        });
    });

    t.test('update: change state', function (t2) {
        var updateParams = {
            state: 'stopped'
        };

        mod_nic.update(t2, {
            mac: mod_nic.lastCreated().mac,
            params: updateParams,
            partialExp: updateParams,
            ts: ts
        });
    });

});

test('Update nic - set "reserved" flag', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var ip = h.nextProvisionableIP(NET2);

    t.test('provision', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: ip,
                state: constants.DEFAULT_NIC_STATE
            })
        });
    });

    t.test('get IP: "reserved" should be false', function (t2) {
        mod_ip.get(t2, {
            net: NET2.uuid,
            ip: ip,
            exp: {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                free: false,
                ip: ip,
                network_uuid: NET2.uuid,
                owner_uuid: params.owner_uuid,
                reserved: false
            }
        });
    });

    t.test('update: change state', function (t2) {
        var updateParams = {
            reserved: true
        };

        mod_nic.update(t2, {
            mac: mod_nic.lastCreated().mac,
            params: updateParams,
            partialExp: extend(params, {
                ip: ip,
                state: constants.DEFAULT_NIC_STATE
            })
        });
    });

    t.test('get IP: "reserved" should be true', function (t2) {
        mod_ip.get(t2, {
            net: NET2.uuid,
            ip: ip,
            exp: {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                free: false,
                ip: ip,
                network_uuid: NET2.uuid,
                owner_uuid: params.owner_uuid,
                reserved: true
            }
        });
    });
});


test('Update nic moray failure getting IP / network', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var ts = {};

    t.test('provision', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: h.nextProvisionableIP(NET2),
                network_uuid: NET2.uuid
            }),
            ts: ts
        });
    });


    t.test('update', function (t2) {
        var errs = [
            null,
            null,
            new Error('Oh no!')
        ];
        MORAY.setMockErrors({ getObject: errs });

        mod_nic.update(t2, {
            mac: mod_nic.lastCreated().mac,
            params: params,
            expCode: 500,
            expErr: {
                code: 'InternalError',
                message: 'Internal error'
            }
        });
    });


    t.test('check error', function (t2) {
        // Make sure we made it to the correct error
        t2.deepEqual(MORAY.getMockErrors().getObject, [],
            'no errors remaining');

        t2.deepEqual(MORAY.getLastMockError(), {
            bucket: ip_common.bucketName(NET2.uuid),
            key: mod_nic.lastCreated().ip,
            op: 'getObject',
            msg: 'Oh no!'
        }, 'last error');

        t2.end();
    });


    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: mod_nic.lastCreated().mac,
            partialExp: extend(params, {
                ip: mod_nic.lastCreated().ip,
                mac: mod_nic.lastCreated().mac,
                network_uuid: NET2.uuid
            }),
            ts: ts
        });
    });

});


test('Update NIC to sibling NIC\'s IP is disallowed (NAPI-385)', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var ip1 = h.nextProvisionableIP(NET2);
    var ip2 = h.nextProvisionableIP(NET2);

    var nic2;

    t.test('provision nic1', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: ip1,
                network_uuid: NET2.uuid
            })
        });
    });

    t.test('provision nic2', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: ip2,
                network_uuid: NET2.uuid
            })
        });
    });

    t.test('update nic2 to nic1\'s IP', function (t2) {
        nic2 = mod_nic.lastCreated();

        mod_nic.update(t2, {
            mac: nic2.mac,
            params: { ip: ip1 },
            expCode: 422,
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', params.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', params.belongs_to_uuid))
                ]
            })
        });
    });
});


// Provision a nic, then change that IP's belongs_to_uuid to something
// else.  Deleting the nic should not free the IP (since it now belongs
// to something else).
test('Delete nic - IP ownership changed underneath', function (t) {
    var ip;
    var nic;
    var other = mod_uuid.v4();
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    t.test('provision', function (t2) {
        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision new nic')) {
                return t2.end();
            }

            nic = res;
            for (var p in params) {
                t2.equal(nic[p], params[p], p + ' correct');
            }

            t2.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            return t2.end();
        });
    });

    t.test('confirm IP ownership', function (t2) {
        NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
            if (h.ifErr(t2, err, 'get IP')) {
                t2.end();
                return;
            }

            ip = res;
            t2.equal(res.ip, nic.ip, 'IP');
            t2.equal(res.belongs_to_uuid, params.belongs_to_uuid, 'IP');
            t2.end();
        });
    });

    t.test('update IP', function (t2) {
        NAPI.updateIP(NET2.uuid, nic.ip, { belongs_to_uuid: other },
            function (err, res) {
            if (h.ifErr(t2, err, 'update IP')) {
                t2.end();
                return;
            }

            ip.belongs_to_uuid = other;
            t2.deepEqual(res, ip, 'only belongs_to_uuid updated');
            t2.end();
        });
    });

    t.test('confirm IP has new belongs_to_uuid', function (t2) {
        NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
            if (h.ifErr(t2, err, 'update IP')) {
                t2.end();
                return;
            }

            t2.deepEqual(res, ip, 'IP unchanged');
            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        NAPI.deleteNic(nic.mac, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'delete nic')) {
                t2.end();
                return;
            }

            t2.equal(res.statusCode, 204, '204 returned');
            t2.end();
        });
    });

    t.test('confirm nic deleted', function (t2) {
        NAPI.getNic(nic.mac, function (err, res) {
            t2.ok(err, 'error expected');
            if (!err) {
                t2.end();
                return;
            }

            t2.equal(err.statusCode, 404, '404 returned');
            t2.end();
        });
    });

    t.test('confirm IP has new owner', function (t2) {
        NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
            if (h.ifErr(t2, err, 'get IP')) {
                t2.end();
                return;
            }

            t2.deepEqual(res, ip, 'IP unchanged');
            t2.end();
        });
    });
});


test('Delete NIC - EtagConflictError on Moray delete', function (t) {
    var mac = '02:04:06:08:10:12';
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };
    var nic;
    var etag;

    t.test('create nic', function (t2) {
        NAPI.createNic(mac, params, function (err, obj, _, res) {
            if (h.ifErr(t2, err, 'create new nic')) {
                t2.end();
                return;
            }

            nic = obj;
            etag = res.headers['etag'];

            t2.end();
        });
    });

    t.test('delete nic encounts EtagConflictError', function (t2) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = {
            bucket: models.nic.bucket().name,
            key: mod_mac.parse(mac).toLong(),
            expected: etag,
            actual: 'foo'
        };

        MORAY.setMockErrors({ batch: [ fakeErr ] });

        mod_nic.del(t2, {
            mac: nic.mac,
            etag: etag,
            expCode: 412,
            expErr: {
                code: 'PreconditionFailed',
                message: fmt('if-match \'%s\' didn\'t match etag \'foo\'', etag)
            }
        }, function (_) {
            // Make sure we actually hit all of the errors:
            t2.deepEqual(MORAY.getMockErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            // Reset moray errors
            MORAY.setMockErrors({ });

            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        mod_nic.del(t2, {
            mac: nic.mac,
            etag: etag
        });
    });

    t.test('confirm nic deleted', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('NAPI-407: Concurrent deletes should fail with 404s', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };
    var nic;

    t.plan(2);

    t.test('provision', function (t2) {
        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision new nic')) {
                t2.end();
                return;
            }

            nic = res;
            for (var p in params) {
                t2.equal(nic[p], params[p], p + ' correct');
            }

            t2.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        var barrier = vasync.barrier();
        var deleted = false;
        var done = 0;

        barrier.on('drain', function () {
            t2.ok(deleted, 'should have deleted NIC once');
            t2.end();
        });

        function onDelete(err, _, req, res) {
            if (err) {
                t2.deepEqual(err.statusCode, 404, 'nic should be gone');
                t2.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'nic not found'
                }, 'correct error body');
            } else {
                if (deleted) {
                    t2.deepEqual(null, res, 'should only delete once');
                } else {
                    t2.equal(res.statusCode, 204, 'successfully deleted');
                    deleted = true;
                }
            }

            done += 1;
            barrier.done('delete-' + done.toString());
        }

        barrier.start('delete-1');
        NAPI.deleteNic(nic.mac, onDelete);

        barrier.start('delete-2');
        NAPI.deleteNic(nic.mac, onDelete);

        barrier.start('delete-3');
        NAPI.deleteNic(nic.mac, onDelete);
    });
});


test('antispoof options', function (t) {
    t.plan(6);
    var d = {};
    d.ts = {};

    t.test('provision', function (t2) {
        d.params = {
            allow_dhcp_spoofing: true,
            allow_ip_spoofing: true,
            allow_mac_spoofing: true,
            allow_restricted_traffic: true,
            allow_unfiltered_promisc: true,
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: d.params,
            partialExp: d.params,
            ts: d.ts
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            d.exp = res;
            d.mac = res.mac;
            delete d.exp.modified_timestamp;
            t2.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Get should succeed');
                t2.ok(!morayObj.hasOwnProperty('network'),
                    'moray object does not have network in it');
                t2.end();
            });
        });
    });

    t.test('get after provision', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: d.params,
            ts: d.ts
        });
    });

    t.test('disable antispoof options', function (t2) {
        d.updateParams = {
            allow_dhcp_spoofing: false,
            allow_ip_spoofing: false,
            allow_mac_spoofing: false,
            allow_restricted_traffic: false,
            allow_unfiltered_promisc: false
        };

        // If set to false, the fields won't appear in the API output
        // anymore:
        for (var p in d.updateParams) {
            delete d.exp[p];
        }

        mod_nic.update(t2, {
            mac: d.mac,
            params: d.updateParams,
            exp: d.exp,
            ts: d.ts
        }, function (err, res) {
            if (h.ifErr(t2, err, 'Update should succeed')) {
                t2.end();
                return;
            }

            // Confirm that the fields have been removed from Moray
            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Get should succeed');
                t2.ok(!morayObj.hasOwnProperty('network'),
                    'Moray object does not have network in it');
                t2.end();
            });
        });
    });

    t.test('get after disable', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });

    t.test('re-enable antispoof options', function (t2) {
        for (var p in d.updateParams) {
            d.updateParams[p] = true;
            d.exp[p] = true;
        }

        mod_nic.update(t2, {
            mac: d.mac,
            params: d.updateParams,
            exp: d.exp,
            ts: d.ts
        }, function (err, res) {
            if (h.ifErr(t2, err, 'Update should succeed')) {
                t2.end();
                return;
            }

            // Confirm that the fields have been removed from Moray
            mod_moray.getNic(MORAY, res.mac, function (err2, morayObj) {
                t2.ifError(err2, 'Get should succeed');
                t2.ok(!morayObj.hasOwnProperty('network'),
                    'Moray object does not have network in it');
                t2.end();
            });
        });
    });

    t.test('get after re-enable', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp,
            ts: d.ts
        });
    });
});


test('update nic that does not exist', function (t) {
    t.plan(2);
    var d = {};

    t.test('update first nic to set primary=true', function (t2) {
        d = {
            mac: h.randomMAC(),
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid: mod_uuid.v4(),
                network_uuid: NET2.uuid
            }
        };

        mod_nic.update(t2, {
            mac: d.mac,
            params: d.params,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('primary uniqueness', function (t) {
    t.plan(5);
    var d = {};

    t.test('create first nic', function (t2) {
        d.macs = [ h.randomMAC(), h.randomMAC() ];
        d.owner = mod_uuid.v4();
        d.zone = mod_uuid.v4();
        d.ts = [ {}, {} ];
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: d.zone,
            mac: d.macs[0],
            owner_uuid: d.owner,
            primary: true
        };

        mod_nic.createAndGet(t2, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            },
            ts: d.ts[0]
        });
    });

    t.test('create second nic with primary=true', function (t2) {
        d.params.mac = d.macs[1];
        mod_nic.createAndGet(t2, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            },
            ts: d.ts[1]
        });
    });

    t.test('first nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[0],
            partialExp: {
                primary: false
            },
            ts: d.ts[0]
        });
    });

    t.test('update first nic to set primary=true', function (t2) {
        mod_nic.updateAndGet(t2, {
            mac: d.macs[0],
            params: {
                primary: true
            },
            partialExp: {
                primary: true
            },
            ts: d.ts[0]
        });
    });

    t.test('second nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[1],
            partialExp: {
                primary: false
            },
            ts: d.ts[1]
        });
    });
});


// --- Listing Tests

test('Listing Nics failures', function (t) {
    t.plan(common.badLimitOffTests.length);

    common.badLimitOffTests.forEach(function (blot) {
        t.test(blot.bc_name, function (t2) {
            mod_nic.list(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    });
});

test('List all NICs', function (t) {
    mod_nic.list(t, {
        present: common.allCreated('nics').map(function (nic) {
            return { mac: nic.mac };
        })
    });
});


test('List 2 NICs', function (t) {
    mod_nic.list(t, {
        params: {
            limit: 2
        }
    }, function (err, res) {
        if (h.ifErr(t, err, 'list nics error')) {
            t.end();
            return;
        }

        t.equal(res.length, 2, 'correct number of NICs returned');
        t.end();
    });
});




// XXX: More tests:
// - should not allow updating an IP to outside the subnet (if only the IP
//   is specified)



// --- Teardown

test('delete nics', mod_nic.delAllCreated);

test('Stop server', mod_server.close);
