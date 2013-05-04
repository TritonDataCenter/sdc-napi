/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for network endpoints
 */

var p = console.log;
var fs = require('fs');
var assert = require('assert-plus');
var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var util = require('util');
var vasync = require('vasync');



// --- Globals


var CONF = JSON.parse(fs.readFileSync(__dirname + '/test-config.json'));

// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var TAG;



// --- Setup



exports['Initial setup'] = function (t) {
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        if (!NAPI) {
            t.done();
        }

        // Match the name of the nic tag in helpers.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            t.ifError(err2);
            TAG = res2;
            t.done();
        });
    });
};



// --- Create tests



exports['Create network'] = function (t) {
    var params = helpers.validNetworkParams({
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
        t.deepEqual(err.body, helpers.invalidParamErr({
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
        t.deepEqual(err.body, helpers.invalidParamErr({
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
                } ]).sort(helpers.fieldSort),
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
        t.deepEqual(err.body, helpers.invalidParamErr({
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
        ['subnet', '1.2.3.4/a', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/7', 'Subnet bits invalid'],
        ['subnet', '1.2.3.4/33', 'Subnet bits invalid'],
        ['subnet', 'c/32', 'Subnet IP invalid'],
        ['subnet', 'a/d', 'Subnet IP and bits invalid'],

        ['vlan_id', 'a', constants.VLAN_MSG],
        ['vlan_id', '-1', constants.VLAN_MSG],
        ['vlan_id', '1', constants.VLAN_MSG],
        ['vlan_id', '4095', constants.VLAN_MSG],

        ['provision_start_ip', '10.0.1.254',
            'provision_start_ip cannot be outside subnet'],
        ['provision_start_ip', '10.0.3.1',
            'provision_start_ip cannot be outside subnet'],
        ['provision_start_ip', '10.0.2.255',
            'provision_start_ip cannot be the broadcast address'],

        ['provision_end_ip', '10.0.1.254',
            'provision_end_ip cannot be outside subnet'],
        ['provision_end_ip', '10.0.3.1',
            'provision_end_ip cannot be outside subnet'],
        ['provision_end_ip', '10.0.2.255',
            'provision_end_ip cannot be the broadcast address'],

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
            var toCreate = helpers.validNetworkParams();
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

                t.deepEqual(err.body, helpers.invalidParamErr({
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
    NAPI.createNetwork(helpers.validNetworkParams({
        provision_start_ip: '10.0.2.250',
        provision_end_ip: '10.0.2.25'
    }), function (err, res) {
        t.ok(err, 'error returned');

        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('provision_end_ip',
                    'provision_start_ip must be before provision_end_ip'),
                mod_err.invalidParam('provision_start_ip',
                    'provision_start_ip must be before provision_end_ip')
            ],
            message: 'Invalid parameters'
        }), 'Error body');

        return t.done();
    });
};



// --- Update tests

// XXX: can't update gateway to outside subnet
// XXX: can't remove an owner_uuid from a network if its parent network
//      pool has that owner


// XXX: can't delete if in use by a network pool


// --- Teardown



exports['Stop server'] = function (t) {
    helpers.stopServer(function (err) {
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
