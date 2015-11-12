/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Unit tests for nic endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../lib/common');
var constants = require('../../lib/util/constants');
var extend = require('xtend');
var fmt = require('util').format;
var h = require('./helpers');
var ip_common = require('../../lib/models/ip/common');
var mod_err = require('../../lib/util/errors');
var mod_ip = require('../lib/ip');
var mod_moray = require('../lib/moray');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nicTag = require('../lib/nic-tag');
var mod_uuid = require('node-uuid');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var restify = require('restify');
var test = require('tape');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');
var vasync = require('vasync');



// --- Globals



var ADMIN_NET;
var NAPI;
var NET;
var NET2;
var NET3;
var PROV_MAC_NET;



// --- Setup



test('Initial setup', function (t) {
    var num = h.NET_NUM;
    var netParams = h.validNetworkParams();

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res) {
            t.ifError(err, 'server creation');
            t.ok(res, 'client');
            NAPI = res;

            return t.end();
        });
    });

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, {
            name: netParams.nic_tag
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
        var params = h.validNetworkParams({ name: 'admin' });
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
                mod_err.invalidParam('belongs_to_type', 'must not be empty'),
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
                mod_err.invalidParam('state', 'must be a valid state'),
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
            owner_uuid: params.owner_uuid
        }, ADMIN_NET);
        t.deepEqual(res, exp, 'create on admin: good response');

        NAPI.getNic(res.mac, function (err2, res2) {
            t.ifError(err2, 'create on admin: get success');
            t.deepEqual(res2, exp, 'create on admin: good get response');
            return t.end();
        });

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

        [ 'IP specified, but not nic_tag or vlan_id',
            { ip: '10.0.2.2', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner },
                [ h.missingParam('nic_tag', constants.msg.IP_NO_VLAN_TAG),
                h.missingParam('vlan_id', constants.msg.IP_NO_VLAN_TAG) ],
                'Missing parameters' ],

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
                [ mod_err.invalidParam('nic_tag',
                    'No networks found matching parameters'),
                mod_err.invalidParam('vlan_id',
                    'No networks found matching parameters') ] ],

        [ 'state must be a string',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, state: true },
                [ mod_err.invalidParam('state', 'must be a string') ] ]

        // XXX: belongs_to_type must be zone, server, other
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
    t.plan(8);
    var d = {};

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
            exp: d.exp
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
            exp: d.exp
        });
    });

    t.test('unset nic_tags_provided', function (t2) {
        delete d.exp.nic_tags_provided;

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: {
                nic_tags_provided: [ ]
            },
            exp: d.exp
        });
    });

    t.test('moray: after update', function (t2) {
        var mNic = mod_moray.getNic(d.exp.mac);
        t2.ok(!mNic.hasOwnProperty('nic_tags_provided'),
            'nic_tags_provided unset on moray object');

        return t2.end();
    });

    t.test('set nic_tags_provided again', function (t2) {
        var params = {
            nic_tags_provided: [ 'tag52' ]
        };
        h.copyParams(params, d.exp);

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: params,
            exp: d.exp
        });
    });

    t.test('unset nic_tags_provided with string', function (t2) {
        delete d.exp.nic_tags_provided;

        mod_nic.updateAndGet(t2, {
            mac: d.exp.mac,
            params: {
                nic_tags_provided: ''
            },
            exp: d.exp
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
            owner_uuid:  mod_uuid.v4()
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
        owner_uuid:  mod_uuid.v4()
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
            vlan_id: NET2.vlan_id
        };
        t.deepEqual(res, exp, 'result');

        NAPI.getNic(res.mac, function (err2, res2) {
            if (h.ifErr(t, err2, 'get provisioned nic')) {
                return t.end();
            }

            t.deepEqual(res2, exp, 'get result');
            return t.end();
        });
    });
});


test('Provision nic: exceed MAC retries', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var numNicsBefore = mod_moray.getNics().length;

    var errs = [ ];
    for (var i = 0; i < constants.MAC_RETRIES + 1; i++) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };
        errs.push(fakeErr);
    }
    mod_moray.setErrors({ batch: errs });

    NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 500, 'status code');
        t.deepEqual(err.body, {
            code: 'InternalError',
            message: 'no more free MAC addresses'
        }, 'Error body');

        // Confirm that the IP was freed
        NAPI.getIP(PROV_MAC_NET.uuid, PROV_MAC_NET.provision_start_ip,
            function (err2, res) {
            if (h.ifErr(t, err2, 'getIP error')) {
                return t.end();
            }

            t.equal(res.free, true, 'IP has been freed');
            var ipRec = mod_moray.getIP(PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip);
            t.ok(!ipRec, 'IP record does not exist in moray');

            t.equal(mod_moray.getNics().length, numNicsBefore,
                'no new nic records added');

            // Make sure we actually hit all of the errors:
            t.deepEqual(mod_moray.getErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.end();
        });
    });
});


test('Provision nic: exceed IP retries', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var numNicsBefore = mod_moray.getNics().length;

    var errs = [ ];
    for (var i = 0; i < constants.IP_PROVISION_RETRIES + 2; i++) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };
        errs.push(fakeErr);
    }
    mod_moray.setErrors({ batch: errs });

    NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 507, 'status code');
        t.deepEqual(err.body, {
            code: 'SubnetFull',
            message: constants.SUBNET_FULL_MSG
        }, 'Error body');

        // Confirm that the IP was freed
        NAPI.getIP(PROV_MAC_NET.uuid, PROV_MAC_NET.provision_start_ip,
            function (err2, res) {
            if (h.ifErr(t, err2, 'getIP error')) {
                return t.end();
            }

            t.equal(res.free, true, 'IP has been freed');
            var ipRec = mod_moray.getIP(PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip);
            t.ok(!ipRec, 'IP record does not exist in moray');

            t.equal(mod_moray.getNics().length, numNicsBefore,
                'no new nic records added');

            // Make sure we actually hit all of the errors:
            t.deepEqual(mod_moray.getErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.end();
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
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };

        mod_moray.setErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic with retry')) {
                return t2.end();
            }

            d.mac = res.mac;
            t2.ok(res.mac, 'MAC address');

            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(morayObj, 'found moray object');
            if (morayObj) {
                t2.equal(morayObj.mac, util_mac.aton(res.mac),
                    'correct mac in moray object');
            }

            t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t2.deepEqual(mod_moray.getErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t2.end();
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
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };

        mod_moray.setErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            expErr: h.invalidParamErr({
                    errors: [ mod_err.duplicateParam('mac') ]
                })
        }, function () {
            var morayObj = mod_moray.getNic(d.mac);
            t2.equal(morayObj, null, 'moray object does not exist');

            // We should have bailed after the first iteration of the loop:
            t2.equal(mod_moray.getErrors().batch.length, 1,
                'one error left');

            // Reset moray errors
            mod_moray.setErrors({ });

            return t2.end();
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
    var d = {};

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        mod_moray.setErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic with retry')) {
                return t2.end();
            }

            d.mac = res.mac;
            t2.ok(res.mac, 'MAC address');

            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(morayObj, 'found moray object');
            if (morayObj) {
                t2.equal(morayObj.mac, util_mac.aton(res.mac),
                    'correct mac in moray object');
            }

            t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t2.deepEqual(mod_moray.getErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t2.end();
        });
    });

    t.test('get provisioned', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
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
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        mod_moray.setErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            partialExp: params
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(res.mac, 'MAC address');
            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(morayObj, 'found moray object');
            if (morayObj) {
                t2.equal(morayObj.mac, util_mac.aton(res.mac),
                    'correct mac in moray object');
            }

            t2.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t2.deepEqual(mod_moray.getErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t2.end();
        });
    });

    t.test('get created', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
        });
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

            d.exp = mod_nic.addDefaultParams({
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: fmt('10.0.%d.200', NET2.num),
                mac: res.mac,
                owner_uuid: params.owner_uuid
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
            owner_uuid:  mod_uuid.v4()
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
                    mod_err.duplicateParam('ip', util.format(
                        constants.fmt.IP_EXISTS, NET2.uuid))
                ]
            })
        });
    });

    // Try updating a nic with a different IP to have that IP

    t.test('create third nic', function (t2) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
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
        owner_uuid:  mod_uuid.v4(),
        state: 'stopped'
    };
    var exp = mod_nic.addDefaultParams({
        belongs_to_type: params.belongs_to_type,
        belongs_to_uuid: params.belongs_to_uuid,
        ip: h.nextProvisionableIP(NET2),
        owner_uuid: params.owner_uuid,
        state: 'stopped'
    }, NET2);

    t.test('(PNDS) provision', function (t2) {
        mod_nic.provision(t2, {
            fillInMissing: true,
            net: NET2.uuid,
            params: params,
            exp: exp
        });
    });

    t.test('(PNDS) get nic', function (t2) {
        mod_nic.get(t2, {
            mac: exp.mac,
            exp: exp
        });
    });

    t.test('(PNDS) update state', function (t2) {
        exp.state = 'running';

        mod_nic.updateAndGet(t2, {
            mac: exp.mac,
            params: {
                state: 'running'
            },
            exp: exp
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
            owner_uuid:  mod_uuid.v4()
        };

        mod_nic.create(t2, {
            mac: d.mac,
            params: d.params,
            partialExp: d.params
        });

    });

    t.test('update', function (t2) {
        d.exp = mod_nic.addDefaultParams({
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: NET3.provision_start_ip,
            mac: d.mac,
            owner_uuid: d.params.owner_uuid
        }, NET3);

        mod_nic.update(t2, {
            mac: d.mac,
            params: {
                network_uuid: NET3.uuid
            },
            exp: d.exp
        });
    });

    t.test('get nic', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
        });
    });

    t.test('get IP', function (t2) {
        mod_ip.get(t2, {
            net: NET3.uuid,
            ip: NET3.provision_start_ip,
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
    t.plan(6);
    var d = {};

    t.test('create', function (t2) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: '10.0.2.188',
            network_uuid: NET.uuid,
            owner_uuid:  mod_uuid.v4()
        };
        d.mac = h.randomMAC();
        d.exp = mod_nic.addDefaultParams({
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: d.params.ip,
            mac: d.mac,
            owner_uuid: d.params.owner_uuid
        }, NET);

        mod_nic.create(t2, {
            mac: d.mac,
            params: d.params,
            exp: d.exp
        });
    });

    t.test('get after create', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
        });
    });

    t.test('update', function (t2) {
        var updateParams = {
            belongs_to_type: 'other',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        h.copyParams(updateParams, d.exp);
        mod_nic.update(t2, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp
        });
    });

    t.test('get after update', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
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

    t.test('update when moray IP object has changed', function (t2) {
        var ipObj = mod_moray.getIP(NET.uuid, d.exp.ip);
        t2.ok(ipObj, 'have IP object');
        ipObj.network = {};

        ipObj = mod_moray.getIP(NET.uuid, d.exp.ip);
        t2.deepEqual(ipObj.network, {});

        mod_nic.update(t2, {
            mac: d.mac,
            params: d.exp,
            exp: d.exp
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
            owner_uuid:  mod_uuid.v4()
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

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            exp: d.exp
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
            exp: d.exp
        });
    });

    t.test('get: after first update', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
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
            exp: d.exp
        });
    });

    t.test('get: after update to ip2', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
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

    t.test('create', function (t2) {
        d.partialExp = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        d.mac = h.randomMAC();
        mod_nic.create(t2, {
            mac: d.mac,
            params: d.partialExp,
            partialExp: d.partialExp
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
            partialExp: d.partialExp
        });
    });
});


test('Update nic - all invalid params', function (t) {
    var mac = h.randomMAC();
    var goodParams = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
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
                    mod_err.invalidParam('belongs_to_type',
                        'must not be empty'),
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
                    mod_err.invalidParam('state', 'must be a valid state'),
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
        owner_uuid:  mod_uuid.v4()
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
            [ mod_err.invalidParam('nic_tag',
                'No networks found matching parameters'),
            mod_err.invalidParam('vlan_id',
                'No networks found matching parameters') ] ],

        [ 'state must be a valid state',
            { ip: fmt('10.0.%d.2', NET.num), network_uuid: NET.uuid,
                state: 'oogabooga' },
            [ mod_err.invalidParam('state',
                'must be a valid state') ] ]
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

    t.test('provision', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
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
            partialExp: partialExp
        });
    });

    t.test('update with same params', function (t2) {
        mod_nic.update(t2, {
            mac: d.nics[0].mac,
            params: d.nics[0],
            exp: d.nics[0]
        });
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
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
            exp: d.nics[0]
        });
    });

    t.test('get after network_uuid', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
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
            exp: d.nics[0]
        });
    });

    t.test('get after mac update', function (t2) {
        mod_nic.get(t2, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
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
        owner_uuid:  mod_uuid.v4()
    };

    t.test('provision', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: h.nextProvisionableIP(NET2),
                state: constants.DEFAULT_NIC_STATE
            })
        });
    });

    t.test('update: change state', function (t2) {
        var updateParams = {
            state: 'stopped'
        };

        mod_nic.update(t2, {
            mac: mod_nic.lastCreated().mac,
            params: updateParams,
            partialExp: updateParams
        });
    });

});


test('Update nic moray failure getting IP / network', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };


    t.test('provision', function (t2) {
        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: params,
            partialExp: extend(params, {
                ip: h.nextProvisionableIP(NET2),
                network_uuid: NET2.uuid
            })
        });
    });


    t.test('update', function (t2) {
        var errs = [
            null,
            null,
            new Error('Oh no!')
        ];
        mod_moray.setErrors({ getObject: errs });

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
        t.deepEqual(mod_moray.getErrors().getObject, [], 'no errors remaining');

        t.deepEqual(mod_moray.getLastError(), {
            bucket: ip_common.bucketName(NET2.uuid),
            key: mod_nic.lastCreated().ip,
            op: 'getObject',
            msg: 'Oh no!'
        }, 'last error');

        return t.end();
    });


    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: mod_nic.lastCreated().mac,
            partialExp: extend(params, {
                ip: mod_nic.lastCreated().ip,
                mac: mod_nic.lastCreated().mac,
                network_uuid: NET2.uuid
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
        owner_uuid:  mod_uuid.v4()
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
               return t2.end();
           }

           ip = res;
           t2.equal(res.ip, nic.ip, 'IP');
           t2.equal(res.belongs_to_uuid, params.belongs_to_uuid, 'IP');

           return t2.end();
       });
    });

    t.test('update IP', function (t2) {
       NAPI.updateIP(NET2.uuid, nic.ip, { belongs_to_uuid: other },
           function (err, res) {
           if (h.ifErr(t2, err, 'update IP')) {
               return t2.end();
           }

           ip.belongs_to_uuid = other;
           t2.deepEqual(res, ip, 'only belongs_to_uuid updated');

           return t2.end();
       });
    });

    t.test('confirm IP has new belongs_to_uuid', function (t2) {
       NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
           if (h.ifErr(t2, err, 'update IP')) {
               return t2.end();
           }

           t2.deepEqual(res, ip, 'IP unchanged');

           return t2.end();
       });
    });

    t.test('delete nic', function (t2) {
       NAPI.deleteNic(nic.mac, function (err, res) {
           if (h.ifErr(t2, err, 'delete nic')) {
               return t2.end();
           }

           return t2.end();
       });
    });

    t.test('confirm nic deleted', function (t2) {
       NAPI.getNic(nic.mac, function (err, res) {
           t2.ok(err, 'error expected');
           if (!err) {
               return t2.end();
           }
           t2.equal(err.statusCode, 404, '404 returned');

           return t2.end();
       });
    });

    t.test('confirm IP has new owner', function (t2) {
       NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
           if (h.ifErr(t2, err, 'get IP')) {
               return t2.end();
           }

           t2.deepEqual(res, ip, 'IP unchanged');
           return t2.end();
       });
    });
});


test('antispoof options', function (t) {
    t.plan(6);
    var d = {};

    t.test('provision', function (t2) {
        d.params = {
            allow_dhcp_spoofing: true,
            allow_ip_spoofing: true,
            allow_mac_spoofing: true,
            allow_restricted_traffic: true,
            allow_unfiltered_promisc: true,
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        mod_nic.provision(t2, {
            net: NET2.uuid,
            params: d.params,
            partialExp: d.params
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            d.exp = res;
            d.mac = res.mac;
            t2.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t2.end();
        });
    });

    t.test('get after provision', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            partialExp: d.params
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
            exp: d.exp
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            // Confirm that the fields have been removed from moray
            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t2.end();
        });
    });

    t.test('get after disable', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
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
            exp: d.exp
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            // Confirm that the fields have been removed from moray
            var morayObj = mod_moray.getNic(res.mac);
            t2.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t2.end();
        });
    });

    t.test('get after re-enable', function (t2) {
        mod_nic.get(t2, {
            mac: d.mac,
            exp: d.exp
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
            }
        });
    });

    t.test('create second nic with primary=true', function (t2) {
        d.params.mac = d.macs[1];
        mod_nic.createAndGet(t2, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            }
        });
    });

    t.test('first nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[0],
            partialExp: {
                primary: false
            }
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
            }
        });
    });

    t.test('second nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[1],
            partialExp: {
                primary: false
            }
        });
    });
});


// --- Listing Tests

test('Listing Nics failures', function (t) {
    t.plan(common.badLimitOffTests.length);

     for (var i = 0; i < common.badLimitOffTests.length; i++) {
        var blot = common.badLimitOffTests[i];
        t.test(blot.bc_name, function (t2) {
            mod_nic.list(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    }
});


// XXX: More tests:
// - create nic with IP, then create another nic with the same IP.  Old nic
//   should no longer have that IP
// - should not allow updating an IP to outside the subnet (if only the IP
//   is specified)



// --- Teardown



test('Stop server', function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
