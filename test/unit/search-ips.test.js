/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Unit tests for /search/ips endpoints
 */

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var restify = require('restify');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var RESERVED_IP = '10.0.2.15';
var NAPI;
var NETS = [];



// --- Internal helpers



/**
 * Sorts an array of objects by network uuid
 */
function uuidSort(a, b) {
    return (a.network_uuid > b.network_uuid) ? 1 : -1;
}



// --- Setup



test('Initial setup', function (t) {
    var netParams = helpers.validNetworkParams();
    var net2Params = helpers.validNetworkParams({
        name: 'net2-' + process.pid
    });
    var net3Params = helpers.validNetworkParams({
        name: 'net3-' + process.pid,
        provision_end_ip: '10.0.3.254',
        provision_start_ip: '10.0.3.1',
        subnet: '10.0.3.0/24'
    });

    function createNet(params, _, cb) {
        NAPI.createNetwork(params, function (err, res) {
            if (res) {
                NETS.push(res);
            }

            return cb(err);
        });
    }

    vasync.pipeline({
    funcs: [
        function createClient(_, cb) {
            helpers.createClientAndServer(function (err, res) {
                t.ok(res, 'client');
                NAPI = res;
                return cb(err);
            });
        },

        function _createNicTag(_, cb) {
            NAPI.createNicTag(netParams.nic_tag, cb);
        },

        createNet.bind(null, netParams),
        createNet.bind(null, net2Params),
        createNet.bind(null, net3Params),

        function _reserveIP(_, cb) {
            NAPI.updateIP(NETS[0].uuid, RESERVED_IP, { reserved: true }, cb);
        }

    ] }, function (pipeErr) {
        helpers.ifErr(t, pipeErr, 'setup pipeline');
        return t.end();
    });
});



// --- Tests



test('provisioned nic', function (t) {
    var params = {
        belongs_to_uuid: mod_uuid.v4(),
        belongs_to_type: 'zone',
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic(NETS[2].uuid, params, function (err, nic) {
        if (helpers.ifErr(t, err, 'provision')) {
            return t.end();
        }

        NAPI.searchIPs(nic.ip, function (err2, res2) {
            if (helpers.ifErr(t, err2, 'search')) {
                return t.end();
            }

            t.deepEqual(res2, [
                {
                    belongs_to_type: params.belongs_to_type,
                    belongs_to_uuid: params.belongs_to_uuid,
                    free: false,
                    ip: nic.ip,
                    network_uuid: NETS[2].uuid,
                    owner_uuid: params.owner_uuid,
                    reserved: false
                }
            ], 'response');

            return t.end();
        });
    });
});


test('Multiple IPs: both in moray and not', function (t) {
    NAPI.searchIPs(RESERVED_IP, function (err, obj, req, res) {
        if (helpers.ifErr(t, err, 'search')) {
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj.sort(uuidSort), [
            {
                free: false,
                ip: RESERVED_IP,
                reserved: true,
                network_uuid: NETS[0].uuid
            },
            {
                free: true,
                ip: RESERVED_IP,
                reserved: false,
                network_uuid: NETS[1].uuid
            }

        ].sort(uuidSort), 'response');

        return t.end();
    });
});


test('Invalid IP', function (t) {
    NAPI.searchIPs('asdf', function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('ip', constants.INVALID_IP_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('IP not in any networks', function (t) {
    NAPI.searchIPs('1.2.3.4', function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'No networks found containing that IP address'
        }, 'Error body');

        return t.end();
    });
});



// --- Teardown



test('Stop server', function (t) {
    helpers.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
