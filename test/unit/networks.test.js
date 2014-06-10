/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for network endpoints
 */

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var fs = require('fs');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var CONF = JSON.parse(fs.readFileSync(__dirname + '/test-config.json'));

var d = {};
// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var TAG;
var MSG = {
    end_outside: 'provision_end_ip cannot be outside subnet',
    end_broadcast: 'provision_end_ip cannot be the broadcast address',
    start_outside: 'provision_start_ip cannot be outside subnet',
    start_broadcast: 'provision_start_ip cannot be the broadcast address'

};



// --- Setup



exports['Initial setup'] = function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        if (!NAPI) {
            t.done();
        }

        // Match the name of the nic tag in h.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            t.ifError(err2);
            TAG = res2;
            t.done();
        });
    });
};



// --- Create tests



exports['Create network'] = function (t) {
    var params = h.validNetworkParams({
        gateway: '10.0.2.1',
        resolvers: ['8.8.8.8', '10.0.2.2'],
        routes: {
            '10.0.1.0/24': '10.0.2.2',
            '10.0.3.1': '10.0.2.2'
        }
    });

    NAPI.createNetwork(params, function (err, obj, req, res) {
        t.ifError(err, 'network create');
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');

        params.uuid = obj.uuid;
        params.netmask = '255.255.255.0';
        params.vlan_id = 0;

        t.deepEqual(obj, params, 'response');

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
                return t.done();
            });
        });
    });
};


exports['Create network - missing parameters'] = function (t) {
    NAPI.createNetwork({}, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
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

        return t.done();
    });
};


exports['Create network - missing and invalid parameters'] = function (t) {
    NAPI.createNetwork({ provision_start_ip: 'asdf' }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
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

        return t.done();
    });
};


exports['Create network - all invalid parameters'] = function (t) {
    var params = {
        gateway: 'asdf',
        name: '',
        nic_tag: 'nictag0',
        provision_end_ip: '10.0.1.256',
        provision_start_ip: '10.256.1.255',
        resolvers: ['10.5.0.256', 'asdf', '2'],
        routes: 'blah',
        subnet: 'asdf',
        vlan_id: 'a'
    };

    NAPI.createNetwork(params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('gateway', 'invalid IP address'),
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

        return t.done();
    });
};



exports['Create network - invalid parameters'] = function (t) {
    var invalid = [
        ['gateway', '10.0.1.254', constants.GATEWAY_SUBNET_MSG],
        ['gateway', '10.0.3.1', constants.GATEWAY_SUBNET_MSG],

        ['subnet', '1.2.3.4/a', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/7', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/33', 'Subnet bits invalid'],
        ['subnet', 'c/32', 'Subnet IP invalid'],
        ['subnet', 'a/d', 'Subnet IP and bits invalid'],

        ['vlan_id', 'a', constants.VLAN_MSG],
        ['vlan_id', '-1', constants.VLAN_MSG],
        ['vlan_id', '1', constants.VLAN_MSG],
        ['vlan_id', '4095', constants.VLAN_MSG],

        ['provision_start_ip', '10.0.1.254', MSG.start_outside],
        ['provision_start_ip', '10.0.3.1', MSG.start_outside],
        ['provision_start_ip', '10.0.2.255', MSG.start_broadcast],

        ['provision_end_ip', '10.0.1.254', MSG.end_outside],
        ['provision_end_ip', '10.0.3.1', MSG.end_outside],
        ['provision_end_ip', '10.0.2.255', MSG.end_broadcast],

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
            'invalid route']
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (data, cb) {
            var toCreate = h.validNetworkParams();
            toCreate[data[0]] = data[1];

            NAPI.createNetwork(toCreate, function (err, res) {
                t.ok(err, util.format('error returned: %s: %s',
                    data[0], typeof (data[1]) === 'object' ?
                    JSON.stringify(data[1]) : data[1]));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422, 'status code');
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
                }), 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.done();
    });
};


exports['Create network - provision start IP after end IP'] = function (t) {
    NAPI.createNetwork(h.validNetworkParams({
        provision_start_ip: '10.0.2.250',
        provision_end_ip: '10.0.2.25'
    }), function (err, res) {
        t.ok(err, 'error returned');

        if (!err) {
            return t.done();
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

        return t.done();
    });
};



// --- Update tests



exports['Update network'] = function (t) {
    var before, expected, nets, p, updateParams;
    var vals = h.validNetworkParams({
        name: 'updateme',
        provision_start_ip: '10.1.2.10',
        provision_end_ip: '10.1.2.250',
        subnet: '10.1.2.0/24'
    });
    delete vals.resolvers;

    vasync.pipeline({
    funcs: [
        function _getNetworksBefore(_, cb) {
            // Get the list of networks before creating the new network - these
            // are added to the workflow parameters so that zone resolvers can
            // be updated
            NAPI.listNetworks(function (err, res) {
                if (h.ifErr(t, err, 'listing networks')) {
                    return cb(err);
                }

                nets = res;
                return cb();
            });

        }, function _create(_, cb) {
            NAPI.createNetwork(vals, function (err, res) {
                if (h.ifErr(t, err, 'creating network')) {
                    return cb(err);
                }

                before = res;
                expected = clone(res);
                return cb();
            });

        }, function _firstUpdate(_, cb) {
            updateParams = {
                description: 'description here',
                gateway: '10.1.2.1',
                owner_uuids: [ mod_uuid.v4() ],
                resolvers: ['8.8.4.4'],
                routes: {
                    '10.2.0.0/16': '10.1.2.1'
                }
            };

            for (p in updateParams) {
                expected[p] = updateParams[p];
            }

            // First, an update from no value to value
            NAPI.updateNetwork(before.uuid, updateParams,
                function (err2, res2) {
                if (h.ifErr(t, err2, 'updating network')) {
                    return cb(err2);
                }

                t.ok(res2.job_uuid, 'job_uuid present');
                expected.job_uuid = res2.job_uuid;

                t.deepEqual(res2, expected, 'params updated');
                delete expected.job_uuid;

                var jobs = h.wfJobs;
                jobs[0].params.networks.sort(h.uuidSort);
                t.deepEqual(jobs, [ {
                    name: 'net-update',
                    params: {
                        original_network: before,
                        target: 'net-update-' + before.uuid,
                        task: 'update',
                        networks:
                            [ expected ].concat(nets).sort(h.uuidSort),
                        update_params: {
                            gateway: updateParams.gateway,
                            resolvers: updateParams.resolvers,
                            routes: updateParams.routes
                        }
                    },
                    uuid: res2.job_uuid
                } ], 'params updated');
                h.wfJobs = [];
                before = res2;
                delete before.job_uuid;

                return cb();
            });

        }, function _secondUpdate(_, cb) {
            // Now update again to make sure we can go from existing value
            // to a different value
            updateParams = {
                description: 'description 2',
                gateway: '10.1.2.2',
                owner_uuids: [ mod_uuid.v4(), mod_uuid.v4() ].sort(),
                provision_start_ip: '10.1.2.9',
                provision_end_ip: '10.1.2.251',
                resolvers: ['8.8.8.8', '10.1.2.1'],
                routes: {
                    '10.2.0.0/16': '10.1.2.2',
                    '10.3.0.0/16': '10.1.2.2'
                }
            };

            for (p in updateParams) {
                expected[p] = updateParams[p];
            }

            NAPI.updateNetwork(before.uuid, updateParams,
                function (err3, res3) {
                if (h.ifErr(t, err3, 'second update')) {
                    return cb(err3);
                }

                t.ok(res3.job_uuid, 'job_uuid present');
                expected.job_uuid = res3.job_uuid;

                t.deepEqual(res3, expected, 'params updated');
                delete expected.job_uuid;

                var jobs = h.wfJobs;
                jobs[0].params.networks.sort(h.uuidSort);
                t.deepEqual(jobs, [ {
                    name: 'net-update',
                    params: {
                        original_network: before,
                        target: 'net-update-' + before.uuid,
                        task: 'update',
                        networks:
                            [ expected ].concat(nets).sort(h.uuidSort),
                        update_params: {
                            gateway: updateParams.gateway,
                            resolvers: updateParams.resolvers,
                            routes: updateParams.routes
                        }
                    },
                    uuid: res3.job_uuid
                } ], 'params updated');
                h.wfJobs = [];

                return cb();
            });
        }, function _checkResult(_, cb) {
            NAPI.getNetwork(before.uuid, function (err4, res4) {
                if (h.ifErr(t, err4, 'second update')) {
                    return cb(err4);
                }

                t.deepEqual(res4, expected, 'params saved');
                return cb();
            });
        }
    ] }, function () {
        return t.done();
    });
};


exports['Update provision range'] = function (t) {
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

    // IP record owned by the admin, type 'other'
    function adminOtherIP(ip) {
        return {
            belongs_to_type: 'other',
            belongs_to_uuid: CONF.ufdsAdminUuid,
            free: false,
            ip: ip,
            network_uuid: net.uuid,
            owner_uuid: CONF.ufdsAdminUuid,
            reserved: true
        };
    }

    // IP record for a zone owned by owner
    function zoneIP(ip) {
        return {
            belongs_to_type: 'zone',
            belongs_to_uuid: zone,
            free: false,
            ip: ip,
            network_uuid: net.uuid,
            owner_uuid: owner,
            reserved: false
        };
    }

    // moray placeholder record
    function placeholderRec(ip) {
        return {
            ip: util_ip.aton(ip),
            reserved: false
        };
    }

    // moray placeholder for an admin 'other' IP
    function adminOtherRec(ip) {
        var ser = adminOtherIP(ip);
        ser.ip = util_ip.aton(ip);
        delete ser.free;
        delete ser.network_uuid;
        return ser;
    }

    // moray placeholder for an admin 'other' IP
    function zoneRec(ip) {
        var ser = zoneIP(ip);
        ser.ip = util_ip.aton(ip);
        delete ser.free;
        delete ser.network_uuid;
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

                t.deepEqual(ips, [ adminOtherIP('10.1.2.255') ], 'IP list');
                return cb();
            });

        }, function (_, cb) {
            t.deepEqual(h.getIPrecords(net.uuid), [
                placeholderRec('10.1.2.9'),
                placeholderRec('10.1.2.251'),
                adminOtherRec('10.1.2.255')
            ]);

            return cb();

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
                    zoneIP('10.1.2.19'),
                    zoneIP('10.1.2.241'),
                    adminOtherIP('10.1.2.255')
                ];
                t.deepEqual(ips, ipList, 'IP list');
                return cb();
            });

        }, function (_, cb) {
            t.deepEqual(h.getIPrecords(net.uuid), [
                placeholderRec('10.1.2.9'),
                zoneRec('10.1.2.19'),
                zoneRec('10.1.2.241'),
                placeholderRec('10.1.2.251'),
                adminOtherRec('10.1.2.255')
            ]);

            return cb();


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
                    ]
                }
            ];
            async.forEachSeries(updates, function (u, cb2) {
                var p = {
                    provision_end_ip: u.provision_end_ip,
                    provision_start_ip: u.provision_start_ip
                };

                NAPI.updateNetwork(net.uuid, p, function (err2, res2) {
                    if (h.ifErr(t, err2, u.desc + ': update network')) {
                        return cb2(err2);
                    }

                    ['provision_start_ip', 'provision_start_ip'].forEach(
                        function (ip) {
                        t.equal(res2[ip], p[ip], u.desc + ': ' + ip);
                    });

                    t.deepEqual(h.getIPrecords(net.uuid), u.morayAfter,
                        u.desc + ': moray');

                    NAPI.listIPs(net.uuid, function (err3, ips) {
                        if (h.ifErr(t, err3, u.desc + ': listing IPs')) {
                            return cb2(err3);
                        }

                        t.deepEqual(ips, ipList, u.desc + ': IP list');
                        return cb2();
                    });
                });
            }, function () {
                return cb();
            });
        }
    ] }, function () {
        return t.done();
    });
};


exports['Update network - invalid parameters'] = function (t) {
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
        ]
    ];

    var vals = h.validNetworkParams({
        name: 'update-invalid',
        provision_start_ip: '10.1.3.10',
        provision_end_ip: '10.1.3.250',
        subnet: '10.1.3.0/24'
    });

    NAPI.createNetwork(vals, function (err, net) {
        if (h.ifErr(t, err, 'creating network')) {
            return t.done();
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
            return t.done();
        });
    });
};


exports['Update network - unset owner_uuids'] = {
    'create': function (t) {
        d.owners = [ mod_uuid.v4(), mod_uuid.v4() ].sort();
        d.params = h.validNetworkParams({
            owner_uuids: d.owners
        });

        mod_net.createAndGet(t, {
            params: d.params,
            partialExp: d.params,
            state: d
        });
    },

    'moray state after create': function (t) {
        d.exp = d.networks[0];
        var obj = h.morayObj('napi_networks', d.exp.uuid);
        t.ok(obj, 'Have moray obj');

        if (obj) {
            t.equal(obj.owner_uuids, ',' + d.owners.join(',') + ',');
        }

        return t.done();
    },

    'list after create': function (t) {
        mod_net.list(t, { provisionable_by: d.owners[0] },
            function (err, res) {
            if (err) {
                return t.done();
            }

            var found;
            res.forEach(function (n) {
                if (n.uuid == d.exp.uuid) {
                    found = n;
                }
            });

            t.ok(found, 'found network in list');
            if (found) {
                t.deepEqual(found.owner_uuids, d.owners, 'owner_uuids correct');
            }

            return t.done();
        });
    },

    'get after create': function (t) {
        mod_net.get(t, {
            uuid: d.exp.uuid,
            params: {
                provisionable_by: d.owners[1]
            },
            exp: d.exp
        });
    },

    'update': function (t) {
        delete d.exp.owner_uuids;

        mod_net.updateAndGet(t, {
            uuid: d.exp.uuid,
            params: {
                owner_uuids: []
            },
            exp: d.exp
        });
    },

    'moray state after update': function (t) {
        d.exp = d.networks[0];
        var obj = h.morayObj('napi_networks', d.exp.uuid);
        t.ok(obj, 'Have moray obj');

        if (obj) {
            t.ok(!obj.hasOwnProperty('owner_uuids'),
                'no owner_uuids property');
        }

        return t.done();
    },

    'list after update': function (t) {
        mod_net.list(t, { provisionable_by: d.owners[0] },
            function (err, res) {
            if (err) {
                return t.done();
            }

            var found;
            res.forEach(function (n) {
                if (n.uuid == d.exp.uuid) {
                    found = n;
                }
            });

            t.ok(found, 'found network in list');
            if (found) {
                t.ok(!found.hasOwnProperty('owner_uuids'),
                    'no owner_uuids property');
            }

            return t.done();
        });
    },

    'get after update': function (t) {
        mod_net.get(t, {
            uuid: d.exp.uuid,
            params: {
                provisionable_by: d.owners[1]
            },
            exp: d.exp
        });
    },

    'create with empty array': function (t) {
        d.exp = {};
        d.params = h.validNetworkParams({
            owner_uuids: []
        });
        h.copyParams(d.param, d.exp);
        delete d.exp.owner_uuids;

        mod_net.createAndGet(t, {
            params: d.params,
            partialExp: d.exp,
            state: d
        });
    },

    'moray state after empty array create': function (t) {
        d.exp = d.networks[1];
        var obj = h.morayObj('napi_networks', d.exp.uuid);
        t.ok(obj, 'Have moray obj');

        if (obj) {
            t.ok(!obj.hasOwnProperty('owner_uuids'),
                'no owner_uuids property');
        }

        return t.done();
    },

    'list after empty create': function (t) {
        mod_net.list(t, { provisionable_by: d.owners[0] },
            function (err, res) {
            if (err) {
                return t.done();
            }

            var found;
            res.forEach(function (n) {
                if (n.uuid == d.exp.uuid) {
                    found = n;
                }
            });

            t.ok(found, 'found network in list');
            if (found) {
                t.ok(!found.hasOwnProperty('owner_uuids'),
                    'no owner_uuids property');
            }

            return t.done();
        });
    },

    'get after empty create': function (t) {
        mod_net.get(t, {
            uuid: d.exp.uuid,
            params: {
                provisionable_by: d.owners[1]
            },
            exp: d.exp
        });
    }
};



// XXX: can't remove an owner_uuid from a network if its parent network
//      pool has that owner



// --- Teardown



exports['Stop server'] = function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports['Initial setup'],
        oneTest: runOne,
        teardown: exports['Stop server']
    };
}
