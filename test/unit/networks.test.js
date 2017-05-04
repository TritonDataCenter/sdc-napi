/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for network endpoints
 */

'use strict';

var clone = require('clone');
var common = require('../lib/common');
var constants = require('../../lib/util/constants');
var fmt = require('util').format;
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_ip = require('../../lib/models/ip');
var mod_moray = require('../lib/moray');
var mod_net = require('../lib/net');
var mod_server = require('../lib/server');
var mod_test_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var CONF = require('../config.json');
// 65 character string:
var LONG_STR =
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var MORAY;
var NAPI;
var TAG;
var MSG = {
    end_outside: constants.msg.PROV_END_IP_OUTSIDE,
    end_broadcast: constants.msg.PROV_END_IP_BCAST,
    mtu_invalid: constants.MTU_NETWORK_INVALID_MSG,
    mtu_over_nictag: constants.MTU_NETWORK_GT_NICTAG,
    start_outside: constants.msg.PROV_START_IP_OUTSIDE,
    start_broadcast: constants.msg.PROV_START_IP_BCAST
};
var USE_STRINGS = true;



// --- Setup



test('Initial setup', function (t) {
    h.reset();

    h.createClientAndServer(function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');
        NAPI = res;
        MORAY = moray;
        if (!NAPI) {
            t.end();
            return;
        }

        // Match the name of the nic tag in h.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            TAG = res2;
            t.ifError(err2, 'no error creating NIC tag');
            t.ok(TAG, 'created NIC tag');
            t.end();
        });
    });
});



// --- Create tests



test('Create network', function (t) {
    var params = h.validNetworkParams({
        gateway: '10.0.2.1',
        resolvers: ['8.8.8.8', '10.0.2.2'],
        routes: {
            '10.0.1.0/24': '10.0.2.2',
            '10.0.3.1': '10.0.2.2'
        }
    });

    NAPI.createNetwork(params, function (err, obj, req, res) {
        if (h.ifErr(t, err, 'network create')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');

        params.family = 'ipv4';
        params.uuid = obj.uuid;
        params.netmask = '255.255.255.0';
        params.vlan_id = 0;

        t.deepEqual(obj, params, 'response: network ' + params.uuid);

        NAPI.getNetwork(obj.uuid, function (err2, obj2) {
            t.ifError(err2);

            t.deepEqual(obj2, obj, 'get response');
            vasync.forEachParallel({
                inputs: ['10.0.2.1', '10.0.2.2', '10.0.2.255'],
                func: function _compareIP(ip, cb) {
                    NAPI.getIP(obj.uuid, ip, function (err3, res3) {
                        t.ifError(err3);
                        t.deepEqual(res3, {
                            belongs_to_type: 'other',
                            belongs_to_uuid: CONF.ufdsAdminUuid,
                            free: false,
                            ip: ip,
                            network_uuid: obj.uuid,
                            owner_uuid: CONF.ufdsAdminUuid,
                            reserved: true
                        }, util.format('IP %s params', ip));

                        return cb();
                    });
                }
            }, function () {
                return t.end();
            });
        });
    });
});

test('Create network - missing parameters', function (t) {
    NAPI.createNetwork({}, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: ['name', 'nic_tag', 'provision_end_ip',
                'provision_start_ip', 'subnet', 'vlan_id'].map(function (name) {
                    return {
                        code: 'MissingParameter',
                        field: name,
                        message: 'Missing parameter'
                    };
                }),
            message: 'Missing parameters'
        }), 'Error body');

        return t.end();
    });
});


test('Create network - missing and invalid parameters', function (t) {
    NAPI.createNetwork({ provision_start_ip: 'asdf' }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: ['name', 'nic_tag', 'provision_end_ip',
                'subnet', 'vlan_id'].map(function (name) {
                    return {
                        code: 'MissingParameter',
                        field: name,
                        message: 'Missing parameter'
                    };
                }).concat([ {
                    code: 'InvalidParameter',
                    field: 'provision_start_ip',
                    message: 'invalid IP address'
                } ]).sort(h.fieldSort),
            message: 'Invalid parameters'
        }), 'Error body');

        return t.end();
    });
});


test('Create network - all invalid parameters', function (t) {
    var params = {
        gateway: 'asdf',
        name: '',
        nic_tag: 'nictag0',
        provision_end_ip: '10.0.1.256',
        provision_start_ip: '10.256.1.255',
        resolvers: ['10.5.0.256', 'asdf'],
        routes: 'blah',
        subnet: 'asdf',
        vlan_id: 'a',
        mtu: 'bullwinkle'
    };

    NAPI.createNetwork(params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('gateway', 'invalid IP address'),
                mod_err.invalidParam('mtu', MSG.mtu_invalid),
                mod_err.invalidParam('name', 'must not be empty'),
                mod_err.invalidParam('nic_tag', 'nic tag does not exist'),
                mod_err.invalidParam('provision_end_ip', 'invalid IP address'),
                mod_err.invalidParam('provision_start_ip',
                    'invalid IP address'),
                {
                    code: 'InvalidParameter',
                    field: 'resolvers',
                    invalid: params.resolvers,
                    message: 'invalid IPs'
                },
                mod_err.invalidParam('routes', 'must be an object'),
                mod_err.invalidParam('subnet', 'Subnet must be in CIDR form'),
                mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
            ],
            message: 'Invalid parameters'
        }), 'Error body');

        return t.end();
    });
});


test('Create network - invalid parameters (non-objects)', function (t) {
    vasync.forEachParallel({
        inputs: h.NON_OBJECT_PARAMS,
        func: function (data, cb) {
            NAPI.post({ path: '/networks' }, data, function (err) {
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


test('Create network - invalid parameters', function (t) {
    // NET_NUM will be the next network number used by h.validNetworkParams():
    var num = h.NET_NUM;
    var baseParams = h.validNetworkParams();

    var invalid = [
        ['gateway', fmt('10.0.%d.254', num - 1), constants.GATEWAY_SUBNET_MSG],
        ['gateway', fmt('10.0.%d.1', num + 1), constants.GATEWAY_SUBNET_MSG],

        ['name', 1, mod_test_err.msg.str],
        ['name', LONG_STR, mod_test_err.msg.longStr],

        ['description', 1, mod_test_err.msg.str],
        ['description', LONG_STR, mod_test_err.msg.longStr],

        ['subnet', '1.2.3.4/a', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/7', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/33', 'Subnet bits invalid'],
        ['subnet', 'c/32', 'Subnet IP invalid'],
        ['subnet', 'a/d', 'Subnet IP invalid'],

        ['vlan_id', 'a', constants.VLAN_MSG],
        ['vlan_id', '-1', constants.VLAN_MSG],
        ['vlan_id', '1', constants.VLAN_MSG],
        ['vlan_id', '4095', constants.VLAN_MSG],

        ['provision_start_ip', fmt('10.0.%d.254', num - 1), MSG.start_outside],
        ['provision_start_ip', fmt('10.0.%d.1', num + 1), MSG.start_outside],
        ['provision_start_ip', fmt('10.0.%d.255', num), MSG.start_broadcast],

        ['provision_end_ip', fmt('10.0.%d.254', num - 1), MSG.end_outside],
        ['provision_end_ip', fmt('10.0.%d.1', num + 1), MSG.end_outside],
        ['provision_end_ip', fmt('10.0.%d.255', num), MSG.end_broadcast],

        ['resolvers', true, constants.msg.ARRAY_OF_STR],
        ['resolvers', 5, constants.msg.ARRAY_OF_STR],
        ['resolvers', [ '1.2.3.4', true ], [ true ], 'invalid IP'],
        ['resolvers', [ 5, true ], [ 5, true ], 'invalid IPs'],

        ['routes', { 'asdf': 'asdf', 'foo': 'bar' },
            [ 'asdf', 'asdf', 'foo', 'bar' ],
            'invalid routes'],

        ['routes', { '10.2.0.0/16': '10.0.1.256' },
            [ '10.0.1.256' ],
            'invalid route'],

        ['routes', { '10.2.0.0/7': '10.0.1.2' },
            [ '10.2.0.0/7' ],
            'invalid route'],

        ['routes', { '10.2.0.0/33': '10.0.1.2' },
            [ '10.2.0.0/33' ],
            'invalid route'],

        // nic_tag created in test setup should be at default
        ['mtu', constants.MTU_DEFAULT + 100, MSG.mtu_over_nictag],
        ['mtu', constants.MTU_NETWORK_MIN - 100, MSG.mtu_invalid],
        ['mtu', constants.MTU_MAX + 100, MSG.mtu_invalid]
    ];

    vasync.forEachPipeline({
        inputs: invalid,
        func: function (data, cb) {
            var toCreate = clone(baseParams);
            toCreate[data[0]] = data[1];

            NAPI.createNetwork(toCreate, function (err, res) {
                t.ok(err, util.format('error returned: %s: %s',
                    data[0], typeof (data[1]) === 'object' ?
                    JSON.stringify(data[1]) : data[1]));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422,
                    util.format('status code for: %s: %s',
                    data[0], typeof (data[1]) === 'object' ?
                    JSON.stringify(data[1]) : data[1]));
                var invalidErr;

                if (data.length === 3) {
                    invalidErr = mod_err.invalidParam(data[0], data[2]);
                } else {
                    invalidErr = mod_err.invalidParam(data[0], data[3]);
                    invalidErr.invalid = data[2];
                }

                t.deepEqual(err.body, h.invalidParamErr({
                    errors: [ invalidErr ],
                    message: 'Invalid parameters'
                }), util.format('Error body for: %s: %s',
                data[0], typeof (data[1]) === 'object' ?
                JSON.stringify(data[1]) : data[1]));

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Create network - mixed networks', function (t) {
    // NET_NUM will be the next network number used by h.validNetworkParams():
    var num = h.NET_NUM.toString(16);
    var baseParams = h.validIPv6NetworkParams();
    var bad_dst = util.format('fc00:%s::2', num);

    var invalid = [
        ['gateway', '10.0.0.1',
            util.format(constants.SUBNET_GATEWAY_MISMATCH, 'ipv6')],

        ['resolvers', ['8.8.8.8', '8.8.4.4'], ['8.8.8.8', '8.8.4.4'],
            util.format(constants.SUBNET_RESOLVER_MISMATCH, 'ipv6')],

        ['resolvers', ['2001:4860:4860::8888', '8.8.4.4'], ['8.8.4.4'],
            util.format(constants.SUBNET_RESOLVER_MISMATCH, 'ipv6')],

        ['routes', { '10.0.1.0/24': bad_dst }, [ '10.0.1.0/24' ],
            util.format(constants.SUBNET_ROUTE_DST_MISMATCH, 'ipv6')],

        ['routes', { '10.0.1.0/24': '10.0.0.2' }, [ '10.0.1.0/24', '10.0.0.2' ],
            util.format(constants.SUBNET_ROUTE_DST_MISMATCH, 'ipv6')],

        ['routes', { '2001:db8::/32': '10.0.0.1' }, [ '10.0.0.1' ],
            util.format(constants.SUBNET_ROUTE_DST_MISMATCH, 'ipv6')],

        ['provision_start_ip', '10.0.0.3',
            constants.msg.PROV_START_TYPE_MISMATCH ],

        ['provision_end_ip', '10.0.0.253',
            constants.msg.PROV_END_TYPE_MISMATCH ]
    ];

    vasync.forEachPipeline({
        inputs: invalid,
        func: function (data, cb) {
            var toCreate = clone(baseParams);
            toCreate[data[0]] = data[1];

            NAPI.createNetwork(toCreate, function (err, res) {
                t.ok(err, util.format('error returned: %s: %s',
                    data[0], typeof (data[1]) === 'object' ?
                    JSON.stringify(data[1]) : data[1]));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422,
                    util.format('status code for: %s: %s',
                    data[0], typeof (data[1]) === 'object' ?
                    JSON.stringify(data[1]) : data[1]));
                var invalidErr;

                if (data.length === 3) {
                    invalidErr = mod_err.invalidParam(data[0], data[2]);
                } else {
                    invalidErr = mod_err.invalidParam(data[0], data[3]);
                    invalidErr.invalid = data[2];
                }

                t.deepEqual(err.body, h.invalidParamErr({
                    errors: [ invalidErr ],
                    message: 'Invalid parameters'
                }), util.format('Error body for: %s: %s',
                data[0], typeof (data[1]) === 'object' ?
                JSON.stringify(data[1]) : data[1]));

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});



test('Create fabric network - automatic gateway assignment', function (t) {
    var gateway = fmt('10.0.%d.1', h.NET_NUM);
    NAPI.createNetwork(h.validNetworkParams({
        fabric: true,
        internet_nat: true,
        vnet_id: 1234
    }), function (err, obj, req, res) {
        if (h.ifErr(t, err, 'network creation')) {
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        NAPI.getNetwork(obj.uuid, function (err2, obj2) {
            t.ifError(err2);

            t.deepEqual(obj2, obj, 'get response');
            NAPI.getIP(obj.uuid, gateway, function (err3, res3) {
                t.ifError(err3);
                t.deepEqual(res3, {
                    belongs_to_type: 'other',
                    belongs_to_uuid: CONF.ufdsAdminUuid,
                    free: false,
                    ip: gateway,
                    network_uuid: obj.uuid,
                    owner_uuid: CONF.ufdsAdminUuid,
                    reserved: true
                }, util.format('IP %s params', gateway));
                t.end();
            });
        });
    });
});

test('Create fabric network - gateway address reserved', function (t) {
    var ip = fmt('10.0.%d.1', h.NET_NUM);
    var owner = '3888cf76-fecd-11e4-b788-ff04f1069d03';
    NAPI.createNetwork(h.validNetworkParams({
        gateway: ip,
        owner_uuids: [owner],
        fabric: true,
        internet_nat: false,
        vnet_id: 1234
    }), function (err, obj, req, res) {
        if (h.ifErr(t, err, 'network creation')) {
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        NAPI.getNetwork(obj.uuid, function (err2, obj2) {
            t.ifError(err2);

            t.deepEqual(obj2, obj, 'get response');
            NAPI.getIP(obj.uuid, ip, function (err3, res3) {
                t.ifError(err3);
                t.deepEqual(res3, {
                    belongs_to_type: 'other',
                    belongs_to_uuid: '00000000-0000-0000-0000-000000000000',
                    free: false,
                    ip: ip,
                    network_uuid: obj.uuid,
                    owner_uuid: owner,
                    reserved: true
                }, util.format('IP %s params', ip));
                t.end();
            });
        });
    });
});

test('Create network - provision start IP after end IP', function (t) {
    NAPI.createNetwork(h.validNetworkParams({
        provision_start_ip: fmt('10.0.%d.250', h.NET_NUM),
        provision_end_ip: fmt('10.0.%d.25', h.NET_NUM)
    }), function (err, res) {
        t.ok(err, 'error returned');

        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('provision_end_ip',
                   constants.PROV_RANGE_ORDER_MSG),
                mod_err.invalidParam('provision_start_ip',
                    constants.PROV_RANGE_ORDER_MSG)
            ],
            message: 'Invalid parameters'
        }), 'Error body');

        return t.end();
    });
});


test('Create network where mtu nic_tag > network > default', function (t) {
    var nicTagName = 'ntmax1';
    var nicTagParams = {
        name: nicTagName,
        mtu: constants.MTU_MAX
    };
    NAPI.createNicTag(nicTagName, nicTagParams, function (err, nictag) {
        if (h.ifErr(t, err, 'nic tag creation')) {
            t.end();
            return;
        }

        nicTagParams.uuid = nictag.uuid;
        t.deepEqual(nictag, nicTagParams, 'correct nictag result');

        var networkParams = h.validNetworkParams({
            nic_tag: nicTagName,
            mtu: constants.MTU_DEFAULT + 1000
        });

        NAPI.createNetwork(networkParams, function (err2, obj, req, res) {
            if (h.ifErr(t, err2, 'network creation')) {
                t.end();
                return;
            }

            t.equal(res.statusCode, 200, 'status code');

            networkParams.family = 'ipv4';
            networkParams.uuid = obj.uuid;
            networkParams.netmask = '255.255.255.0';
            networkParams.vlan_id = 0;

            t.deepEqual(obj, networkParams, 'response: network creation'
                + networkParams.uuid);

            NAPI.getNetwork(obj.uuid, function (err3, res3) {
                t.ifError(err3);
                t.equal(res3.mtu, networkParams.mtu, 'MTU correct after get');
                t.end();
            });
        });
    });
});


test('Create network where mtu == nic_tag == max', function (t) {
    var nicTagName = 'nictagmax2';
    var nicTagParams = {
        name: nicTagName,
        mtu: constants.MTU_MAX
    };
    NAPI.createNicTag(nicTagName, nicTagParams, function (err, nictag) {
        if (h.ifErr(t, err, 'nic tag creation')) {
            return t.end();
        }

        nicTagParams.uuid = nictag.uuid;
        t.deepEqual(nictag, nicTagParams, 'correct nictag result');

        var networkParams = h.validNetworkParams({
            nic_tag: nicTagName,
            mtu: constants.MTU_DEFAULT + 1000
        });

        NAPI.createNetwork(networkParams, function (err2, obj, req, res) {
            if (h.ifErr(t, err2, 'network creation')) {
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');

            networkParams.family = 'ipv4';
            networkParams.uuid = obj.uuid;
            networkParams.netmask = '255.255.255.0';
            networkParams.vlan_id = 0;

            t.deepEqual(obj, networkParams, 'response: network '
                + networkParams.uuid);

            NAPI.getNetwork(obj.uuid, function (err3, res3) {
                t.ifError(err3);

                t.equal(res3.mtu, networkParams.mtu);
                return t.end();
            });
        });
    });
});


test('Create fabric network - non-private subnet', function (t) {
    NAPI.createNetwork(h.validNetworkParams({
        fabric: true,
        provision_start_ip: fmt('123.0.%d.1', h.NET_NUM),
        provision_end_ip: fmt('123.0.%d.254', h.NET_NUM),
        subnet: fmt('123.0.%d.0/24', h.NET_NUM)
    }), function (err, res) {
        t.ok(err, 'error returned');

        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('subnet',
                    constants.PRIV_RANGE_ONLY)
            ],
            message: 'Invalid parameters'
        }), 'Error body');

        return t.end();
    });
});

// --- Update tests



test('Update network', function (t) {
    var before;
    var expected;
    var num = h.NET_NUM;
    var p;
    var updateParams;
    var vals = h.validNetworkParams({
        name: 'updateme',
        provision_start_ip: fmt('10.1.%d.10', num),
        provision_end_ip: fmt('10.1.%d.250', num),
        subnet: fmt('10.1.%d.0/24', num)
    });
    delete vals.resolvers;

    t.test('store networks from before', function (t2) {
        // Get the list of networks before creating the new network - these
        // are added to the workflow parameters so that zone resolvers can
        // be updated
        NAPI.listNetworks(function (err, res) {
            if (h.ifErr(t2, err, 'listing networks')) {
                return t2.end();
            }

            return t2.end();
        });
    });

    t.test('create', function (t2) {
        NAPI.createNetwork(vals, function (err, res) {
            if (h.ifErr(t2, err, 'creating network')) {
                return t2.end();
            }

            before = res;
            expected = clone(res);
            return t2.end();
        });
    });

    t.test('first update', function (t2) {
        updateParams = {
            description: 'description here',
            gateway: fmt('10.1.%d.1', num),
            owner_uuids: [ mod_uuid.v4() ],
            resolvers: ['8.8.4.4'],
            routes: {
                '10.2.0.0/16': fmt('10.1.%d.1', num)
            }
        };

        for (p in updateParams) {
            expected[p] = updateParams[p];
        }

        // First, an update from no value to value
        NAPI.updateNetwork(before.uuid, updateParams,
            function (err2, res2) {
            if (h.ifErr(t2, err2, 'updating network')) {
                return t2.end();
            }

            t2.deepEqual(res2, expected, 'params updated');


            return t2.end();
        });
    });

    t.test('second update', function (t2) {
        // Now update again to make sure we can go from existing value
        // to a different value
        updateParams = {
            description: 'description 2',
            gateway: fmt('10.1.%d.2', num),
            owner_uuids: [ mod_uuid.v4(), mod_uuid.v4() ].sort(),
            provision_start_ip: fmt('10.1.%d.9', num),
            provision_end_ip: fmt('10.1.%d.251', num),
            resolvers: ['8.8.8.8', fmt('10.1.%d.1', num)],
            routes: {
                '10.2.0.0/16': fmt('10.1.%d.2', num),
                '10.3.0.0/16': fmt('10.1.%d.2', num)
            },
            mtu: constants.MTU_DEFAULT - 100
        };

        for (p in updateParams) {
            expected[p] = updateParams[p];
        }

        NAPI.updateNetwork(before.uuid, updateParams,
            function (err3, res3) {
            if (h.ifErr(t2, err3, 'second update')) {
                return t2.end();
            }

            t2.deepEqual(res3, expected, 'params updated');

            return t2.end();
        });
    });

    t.test('get after second update', function (t2) {
        NAPI.getNetwork(before.uuid, function (err4, res4) {
            if (h.ifErr(t2, err4, 'second update')) {
                return t2.end();
            }

            t2.deepEqual(res4, expected, 'params saved');
            return t2.end();
        });
    });
});


test('Update provision range', function (t) {
    // IPs expected from the API when listing IPs for the network
    var ipList;
    var net;
    var owner = mod_uuid.v4();
    var vals = h.validNetworkParams({
        name: 'provision_range_test',
        provision_start_ip: '10.1.2.10',
        provision_end_ip: '10.1.2.250',
        subnet: '10.1.2.0/24',
        vlan_id: 42
    });
    var zone = mod_uuid.v4();

    // Unreserved placeholder IP
    function placeholderIP(ip) {
        var rec = {
            ip: ip,
            reserved: false,
            network_uuid: net.uuid,
            free: true
        };
        return rec;
    }

    // IP record owned by the admin, type 'other'
    function adminOtherIP(ip) {
        var rec = {
            belongs_to_type: 'other',
            belongs_to_uuid: CONF.ufdsAdminUuid,
            free: false,
            ip: ip,
            network_uuid: net.uuid,
            owner_uuid: CONF.ufdsAdminUuid,
            reserved: true
        };
        return rec;
    }

    // IP record for a zone owned by owner
    function zoneIP(ip) {
        var rec = {
            belongs_to_type: 'zone',
            belongs_to_uuid: zone,
            free: false,
            ip: ip,
            network_uuid: net.uuid,
            owner_uuid: owner,
            reserved: false
        };
        return rec;
    }

    // moray placeholder record
    function placeholderRec(ip) {
        var ser = placeholderIP(ip);

        ser.ipaddr = ser.ip;
        delete ser.ip;
        delete ser.free;
        delete ser.network_uuid;
        if (USE_STRINGS) {
            ser.use_strings = true;
            ser.v = mod_ip.BUCKET.version;
        }
        return ser;
    }

    // moray placeholder for an admin 'other' IP
    function adminOtherRec(ip) {
        var ser = adminOtherIP(ip);

        ser.ipaddr = ser.ip;
        delete ser.ip;
        delete ser.free;
        delete ser.network_uuid;
        if (USE_STRINGS) {
            ser.use_strings = true;
            ser.v = mod_ip.BUCKET.version;
        }
        return ser;
    }

    // moray placeholder for an admin 'other' IP
    function zoneRec(ip) {
        var ser = zoneIP(ip);

        ser.ipaddr = ser.ip;
        delete ser.ip;
        delete ser.free;
        delete ser.network_uuid;
        if (USE_STRINGS) {
            ser.use_strings = true;
            ser.v = mod_ip.BUCKET.version;
        }
        return ser;
    }

    vasync.pipeline({
    funcs: [
        function _create(_, cb) {
            NAPI.createNetwork(vals, function (err, res) {
                if (h.ifErr(t, err, 'creating network')) {
                    return cb(err);
                }

                ['provision_start_ip', 'provision_start_ip'].forEach(
                    function (ip) {
                    t.equal(res[ip], vals[ip], ip);
                });

                net = clone(res);
                return cb();
            });

        }, function (_, cb) {
            NAPI.listIPs(net.uuid, function (err, ips) {
                if (h.ifErr(t, err, 'listing IPs')) {
                    return cb(err);
                }

                t.deepEqual(ips, [
                    placeholderIP('10.1.2.9'),
                    placeholderIP('10.1.2.251'),
                    adminOtherIP('10.1.2.255') ], 'IP list');
                return cb();
            });

        }, function (_, cb) {
            mod_moray.getIPs(MORAY, net.uuid, function (err, ips) {
                t.ifError(err, 'Getting IPs shouldn\'t fail');
                t.deepEqual(ips, [
                    placeholderRec('10.1.2.9'),
                    placeholderRec('10.1.2.251'),
                    adminOtherRec('10.1.2.255')
                ], 'Moray IPs');

                cb();
            });
        }, function (_, cb) {
            var ip = '10.1.2.19';
            var params = {
                belongs_to_type: 'zone',
                belongs_to_uuid: zone,
                owner_uuid: owner
            };

            NAPI.updateIP(net.uuid, ip, params, function (err, res) {
                if (h.ifErr(t, err, 'update: ' + ip)) {
                    return cb(err);
                }

                Object.keys(params).forEach(function (p) {
                    t.equal(res[p], params[p], ip + ': ' + p);
                });

                return cb();
            });

        }, function (_, cb) {
            var ip = '10.1.2.241';
            var params = {
                belongs_to_type: 'zone',
                belongs_to_uuid: zone,
                owner_uuid: owner
            };

            NAPI.updateIP(net.uuid, ip, params, function (err, res) {
                if (h.ifErr(t, err, 'update: ' + ip)) {
                    return cb(err);
                }

                Object.keys(params).forEach(function (p) {
                    t.equal(res[p], params[p], ip + ': ' + p);
                });

                return cb();
            });


        }, function (_, cb) {
            NAPI.listIPs(net.uuid, function (err, ips) {
                if (h.ifErr(t, err, 'listing IPs')) {
                    return cb(err);
                }

                ipList = [
                    placeholderIP('10.1.2.9'),
                    zoneIP('10.1.2.19'),
                    zoneIP('10.1.2.241'),
                    placeholderIP('10.1.2.251'),
                    adminOtherIP('10.1.2.255')
                ];
                t.deepEqual(ips, ipList, 'IP list after first update');
                return cb();
            });

        }, function (_, cb) {
            mod_moray.getIPs(MORAY, net.uuid, function (err, ips) {
                t.ifError(err, 'Getting IPs shouldn\'t fail');
                t.deepEqual(ips, [
                    placeholderRec('10.1.2.9'),
                    zoneRec('10.1.2.19'),
                    zoneRec('10.1.2.241'),
                    placeholderRec('10.1.2.251'),
                    adminOtherRec('10.1.2.255')
                ], 'moray list after first update');

                cb();
            });
        }, function (_, cb) {
            var updates = [
                {
                    desc: 'one below original',
                    provision_start_ip: '10.1.2.9',
                    provision_end_ip: '10.1.2.249',
                    morayAfter: [
                        placeholderRec('10.1.2.8'),
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        placeholderRec('10.1.2.250'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        placeholderIP('10.1.2.8'),
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        placeholderIP('10.1.2.250'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    desc: 'back to original',
                    provision_start_ip: '10.1.2.10',
                    provision_end_ip: '10.1.2.250',
                    morayAfter: [
                        placeholderRec('10.1.2.9'),
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        placeholderRec('10.1.2.251'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        placeholderIP('10.1.2.9'),
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        placeholderIP('10.1.2.251'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    desc: 'no change',
                    provision_start_ip: '10.1.2.10',
                    provision_end_ip: '10.1.2.250',
                    morayAfter: [
                        placeholderRec('10.1.2.9'),
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        placeholderRec('10.1.2.251'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        placeholderIP('10.1.2.9'),
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        placeholderIP('10.1.2.251'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    desc: 'one after original',
                    provision_start_ip: '10.1.2.11',
                    provision_end_ip: '10.1.2.251',
                    morayAfter: [
                        placeholderRec('10.1.2.10'),
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        placeholderRec('10.1.2.252'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        placeholderIP('10.1.2.10'),
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        placeholderIP('10.1.2.252'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    // If the placeholder records on either side of the
                    // provision range already exist, reuse the records
                    desc: 'placeholders exist',
                    provision_start_ip: '10.1.2.20',
                    provision_end_ip: '10.1.2.240',
                    morayAfter: [
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    desc: 'non-placeholder to placeholder',
                    provision_start_ip: '10.1.2.30',
                    provision_end_ip: '10.1.2.230',
                    morayAfter: [
                        zoneRec('10.1.2.19'),
                        placeholderRec('10.1.2.29'),
                        placeholderRec('10.1.2.231'),
                        zoneRec('10.1.2.241'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        zoneIP('10.1.2.19'),
                        placeholderIP('10.1.2.29'),
                        placeholderIP('10.1.2.231'),
                        zoneIP('10.1.2.241'),
                        adminOtherIP('10.1.2.255')
                    ]
                },
                {
                    desc: 'back to outside zone IPs',
                    provision_start_ip: '10.1.2.16',
                    provision_end_ip: '10.1.2.244',
                    morayAfter: [
                        placeholderRec('10.1.2.15'),
                        zoneRec('10.1.2.19'),
                        zoneRec('10.1.2.241'),
                        placeholderRec('10.1.2.245'),
                        adminOtherRec('10.1.2.255')
                    ],
                    ipList: [
                        placeholderIP('10.1.2.15'),
                        zoneIP('10.1.2.19'),
                        zoneIP('10.1.2.241'),
                        placeholderIP('10.1.2.245'),
                        adminOtherIP('10.1.2.255')
                    ]
                }
            ];

            function updateBoundaries(u, cb2) {
                var p = {
                    provision_end_ip: u.provision_end_ip,
                    provision_start_ip: u.provision_start_ip
                };

                NAPI.updateNetwork(net.uuid, p, function (err2, res2) {
                    if (h.ifErr(t, err2, u.desc + ': update network')) {
                        cb2(err2);
                        return;
                    }

                    ['provision_start_ip', 'provision_end_ip'].forEach(
                        function (ip) {
                        t.equal(res2[ip], p[ip], u.desc + ': ' + ip);
                    });

                    mod_moray.getIPs(MORAY, net.uuid, function (mErr, ipObjs) {
                        t.ifError(mErr, 'Getting IPs shouldn\'t fail');
                        t.deepEqual(ipObjs, u.morayAfter, u.desc + ': moray');

                        NAPI.listIPs(net.uuid, function (lErr, ips) {
                            if (h.ifErr(t, lErr, u.desc + ': listing IPs')) {
                                cb2(lErr);
                                return;
                            }

                            t.deepEqual(ips, u.ipList, u.desc + ': IP list');
                            cb2();
                        });
                    });
                });
            }

            vasync.forEachPipeline({
                'inputs': updates,
                'func': updateBoundaries
            }, cb);
        }
    ] }, function (err) {
        t.ifErr(err, 'provision range tests should finish cleanly');
        t.end();
    });
});


test('Update network - invalid parameters', function (t) {
    var invalid = [
        [ { provision_start_ip: '10.1.2.254' },
          { provision_start_ip: MSG.start_outside }
        ],
        [ { provision_start_ip: '10.1.4.1' },
          { provision_start_ip: MSG.start_outside }
        ],
        [ { provision_start_ip: '10.1.3.255' },
          { provision_start_ip: MSG.start_broadcast }
        ],
        [ { provision_end_ip: '10.1.2.254' },
          { provision_end_ip: MSG.end_outside }
        ],
        [ { provision_end_ip: '10.1.4.1' },
          { provision_end_ip: MSG.end_outside }
        ],
        [ { provision_end_ip: '10.1.3.255' },
          { provision_end_ip: MSG.end_broadcast }
        ],

        [ {
            provision_start_ip: '10.1.3.40',
            provision_end_ip: '10.1.3.30'
          },
          {
              provision_start_ip: constants.PROV_RANGE_ORDER_MSG,
              provision_end_ip: constants.PROV_RANGE_ORDER_MSG
          }
        ],
        [ { provision_start_ip: '10.1.3.251' },
          {
              provision_start_ip: constants.PROV_RANGE_ORDER_MSG,
              provision_end_ip: constants.PROV_RANGE_ORDER_MSG
          }
        ],
        [ { provision_end_ip: '10.1.3.9' },
          {
              provision_start_ip: constants.PROV_RANGE_ORDER_MSG,
              provision_end_ip: constants.PROV_RANGE_ORDER_MSG
          }
        ],

        [ { routes: { 'asdf': 'asdf', 'foo': 'bar' } },
          { routes: [ 'invalid routes', [ 'asdf', 'asdf', 'foo', 'bar' ] ] }
        ],
        [ { routes: { '10.2.0.0/16': '10.0.1.256' } },
          { routes: ['invalid route', [ '10.0.1.256' ] ] }
        ],
        [ { routes: { '10.2.0.0/7': '10.0.1.2' } },
          { routes: ['invalid route', [ '10.2.0.0/7' ] ] }
        ],
        [ { routes: { '10.2.0.0/33': '10.0.1.2' } },
          { routes: ['invalid route', [ '10.2.0.0/33' ] ] }
        ],

        [ { gateway: '10.1.2.254' },
          { gateway: constants.GATEWAY_SUBNET_MSG }
        ],
        [ { gateway: '10.1.4.1' },
          { gateway: constants.GATEWAY_SUBNET_MSG }
        ],

        [ { name: 1 }, { name: mod_test_err.msg.str } ],
        [ { name: LONG_STR }, { name: mod_test_err.msg.longStr } ],

        [ { description: 1 }, { description: mod_test_err.msg.str } ],
        [ { description: LONG_STR }, { description: mod_test_err.msg.longStr } ]
    ];

    var vals = h.validNetworkParams({
        name: 'update-invalid',
        provision_start_ip: '10.1.3.10',
        provision_end_ip: '10.1.3.250',
        subnet: '10.1.3.0/24'
    });

    NAPI.createNetwork(vals, function (err, net) {
        if (h.ifErr(t, err, 'creating network')) {
            return t.end();
        }

        vasync.forEachParallel({
            inputs: invalid,
            func: function (data, cb) {
                NAPI.updateNetwork(net.uuid, data[0], function (err2, res) {
                    t.ok(err2, util.format('error returned: %s',
                        JSON.stringify(data[0])));
                    if (!err2) {
                        return cb();
                    }

                    t.equal(err2.statusCode, 422, 'status code');
                    var invalidErrs = [];

                    Object.keys(data[1]).sort().forEach(function (k) {
                        var iErr = mod_err.invalidParam(k,
                            util.isArray(data[1][k]) ?
                                data[1][k][0] : data[1][k]);
                        if (util.isArray(data[1][k])) {
                            iErr.invalid = data[1][k][1];
                        }

                        invalidErrs.push(iErr);
                    });

                    t.deepEqual(err2.body, h.invalidParamErr({
                        errors: invalidErrs,
                        message: 'Invalid parameters'
                    }), 'Error body');

                    return cb();
                });
            }
        }, function () {
            return t.end();
        });
    });
});


test('Update network - unset owner_uuids', function (t) {
    t.plan(16);

    var exp;
    var networks = [];
    var owners = [];
    var params = [];

    t.test('create', function (t2) {
        owners = [ mod_uuid.v4(), mod_uuid.v4() ].sort();
        params = h.validNetworkParams({
            owner_uuids: owners
        });

        mod_net.createAndGet(t2, {
            params: params,
            partialExp: params,
            state: { networks: networks }
        });
    });

    t.test('moray state after create', function (t2) {
        exp = networks[0];
        MORAY.getObject('napi_networks', exp.uuid, function (err, obj) {
            t2.ifError(err, 'Getting network shouldn\'t fail');
            t2.ok(obj, 'Have Moray obj');

            if (obj) {
                obj = obj.value;
                t2.equal(obj.owner_uuids, ',' + owners.join(',') + ',',
                    'owner_uuids');
                t2.deepEqual(obj.owner_uuids_arr, owners, 'owner_uuids_arr');
            }

            t2.end();
        });
    });

    t.test('list after create', function (t2) {
        mod_net.list(t2, {
            params: {
                provisionable_by: owners[0]
            },
            present: [ {
                uuid: exp.uuid,
                owner_uuids: owners
            } ]
        });
    });

    t.test('get after create', function (t2) {
        mod_net.get(t2, {
            params: {
                provisionable_by: owners[1],
                uuid: exp.uuid
            },
            exp: exp
        });
    });

    t.test('update', function (t2) {
        delete exp.owner_uuids;

        mod_net.updateAndGet(t2, {
            params: {
                owner_uuids: [],
                uuid: exp.uuid
            },
            exp: exp
        });
    });

    t.test('moray state after update', function (t2) {
        exp = networks[0];
        MORAY.getObject('napi_networks', exp.uuid, function (err, obj) {
            t2.ifError(err, 'Getting network shouldn\'t fail');
            t2.ok(obj, 'Have Moray obj');

            if (obj) {
                obj = obj.value;
                t2.ok(!obj.hasOwnProperty('owner_uuids'),
                    'no owner_uuids property');
                t2.ok(!obj.hasOwnProperty('owner_uuids_arr'),
                    'no owner_uuids property');
            }

            t2.end();
        });
    });

    t.test('list after update', function (t2) {
        mod_net.list(t2, {
            params: {
                provisionable_by: owners[0]
            },
            present: [ {
                uuid: exp.uuid,
                owner_uuids: undefined
            } ]
        });
    });

    t.test('get after update', function (t2) {
        mod_net.get(t2, {
            params: {
                provisionable_by: owners[1],
                uuid: exp.uuid
            },
            exp: exp
        });
    });

    t.test('create with empty array', function (t2) {
        exp = {};
        params = h.validNetworkParams({
            owner_uuids: []
        });
        h.copyParams(params, exp);
        delete exp.owner_uuids;

        mod_net.createAndGet(t2, {
            params: params,
            partialExp: exp,
            state: { networks: networks }
        });
    });

    t.test('moray state after empty array create', function (t2) {
        exp = networks[1];
        MORAY.getObject('napi_networks', exp.uuid, function (err, obj) {
            t2.ifError(err, 'Getting network shouldn\'t fail');
            t2.ok(obj, 'Have Moray obj');

            if (obj) {
                obj = obj.value;
                t2.ok(!obj.hasOwnProperty('owner_uuids'),
                    'no owner_uuids property');
                t2.ok(!obj.hasOwnProperty('owner_uuids_arr'),
                    'no owner_uuids_arr property');
            }

            t2.end();
        });
    });

    t.test('list after empty create', function (t2) {
        mod_net.list(t2, {
            params: {
                provisionable_by: owners[1]
            },
            present: [ exp ]
        });
    });

    t.test('get after empty create', function (t2) {
        mod_net.get(t2, {
            params: {
                provisionable_by: owners[1],
                uuid: exp.uuid
            },
            exp: exp
        });
    });

    t.test('NAPI-186: owner_uuids=",," should be okay', function (t2) {
        // The string ',,' should be okay to return from Moray.
        MORAY.getObject('napi_networks', exp.uuid, function (gErr, res) {
            if (h.ifErr(t2, gErr, 'getObject() error')) {
                t2.end();
                return;
            }

            delete res.value.owner_uuids_arr;
            res.value.owner_uuids = ',,';

            MORAY.putObject('napi_networks', exp.uuid, res.value,
                function (pErr) {
                t2.ifError(pErr, 'Putting new network object should succeed');

                mod_net.get(t2, {
                    params: {
                        provisionable_by: owners[1],
                        uuid: exp.uuid
                    },
                    exp: exp
                });
            });
        });
    });

    t.test('list after moray object change', function (t2) {
        mod_net.list(t2, {
            present: [ {
                uuid: exp.uuid,
                owner_uuids: undefined
            } ]
        });
    });

    t.test('owner_uuids_arr=[] should be okay', function (t2) {
        // An empty array should be okay to return from Moray.
        MORAY.getObject('napi_networks', exp.uuid, function (gErr, res) {
            if (h.ifErr(t2, gErr, 'getObject() error')) {
                t2.end();
                return;
            }

            res.value.owner_uuids_arr = [];
            exp.owner_uuids = [];

            MORAY.putObject('napi_networks', exp.uuid, res.value,
                function (pErr) {
                t2.ifError(pErr, 'Putting new network object should succeed');

                mod_net.get(t2, {
                    params: {
                        provisionable_by: owners[1],
                        uuid: exp.uuid
                    },
                    exp: exp
                });
            });
        });
    });

    t.test('list after moray object change', function (t2) {
        mod_net.list(t2, {
            present: [ {
                uuid: exp.uuid,
                owner_uuids: []
            } ]
        });
    });
});


// --- List Networks

test('Listing Network failures', function (t) {
    t.plan(common.badLimitOffTests.length);

    for (var i = 0; i < common.badLimitOffTests.length; i++) {
        var blot = common.badLimitOffTests[i];
        t.test(blot.bc_name, function (t2) {
            mod_net.list(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    }
});


// XXX: can't remove an owner_uuid from a network if its parent network
//      pool has that owner



// --- Teardown



test('Stop server', mod_server.close);
