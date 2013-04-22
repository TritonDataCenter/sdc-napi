/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var async = require('async');
var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var NET1;
var NET2;
var POOL1;



// --- Internal helpers



// --- Setup



exports['Initial setup'] = function (t) {
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.done();
        }

        var net1Params = helpers.validNetworkParams({
            name: 'net1',
            provision_end_ip: '10.0.1.5',
            provision_start_ip: '10.0.1.2',
            subnet: '10.0.1.0/29',
            // Explicitly pick a UUID to make sure it sorts before NET2
            uuid: '0d281aa3-8d70-4666-a118-b1b88669f11f'
        });


        vasync.pipeline({
        funcs: [
            function _nicTag(_, cb) {
                NAPI.createNicTag(net1Params.nic_tag, cb);
            },

            function _testNet(_, cb) {
                NAPI.createNetwork(net1Params, function (err2, res2) {
                    NET1 = res2;
                    cb(err2);
                });
            },

            function _testNet2(_, cb) {
                var params = helpers.validNetworkParams({
                    name: 'net2',
                    provision_end_ip: '10.0.1.12',
                    provision_start_ip: '10.0.1.9',
                    subnet: '10.0.1.8/29',
                    uuid: 'b8e57862-54fa-4667-89ae-c981cd5ada9a'
                });

                NAPI.createNetwork(params, function (err2, res2) {
                    NET2 = res2;
                    cb(err2);
                });
            },

            function _netPool1(_, cb) {
                var params = {
                    networks: [ NET1.uuid, NET2.uuid ]
                };

                NAPI.createNetworkPool('pool1-' + process.pid, params,
                    function (err2, res2) {
                    POOL1 = res2;
                    cb(err2);
                });
            }

        ] }, function (pipelineErr) {
            t.ifError(pipelineErr);
            if (pipelineErr) {
                t.deepEqual(pipelineErr.body, {}, 'pipeline error body');
            }

            return t.done();
        });
    });
};



// --- Provisioning tests



exports['Provision nic - on network pool with IP'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: NET2.provision_start_ip,
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(POOL1.uuid, params, function (err, res) {
        t.ok(err);
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ mod_err.invalidParam('ip', constants.POOL_IP_MSG) ]
        }), 'error body');

        return t.done();
    });
};


exports['Provision nic - on network pool'] = function (t) {
    var earlyOutErr;
    var ipNums = ['2', '3', '4', '5', '9', '10', '11', '12'];

    async.whilst(
        function () { return (!earlyOutErr && ipNums.length !== 0); },
        function (cb) {
            var params = {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid:  mod_uuid.v4()
            };
            var nextIPnum = ipNums.shift();
            var nextIP = '10.0.1.' + nextIPnum;

            NAPI.provisionNic(POOL1.uuid, params, function (err, res) {
                t.ifError(err);
                if (err) {
                    earlyOutErr = err;
                    t.deepEqual(err.body, {}, 'error body');
                    return cb();
                }

                var net = nextIPnum < 6 ? NET1 : NET2;
                t.deepEqual(res, {
                    belongs_to_type: params.belongs_to_type,
                    belongs_to_uuid: params.belongs_to_uuid,
                    ip: nextIP,
                    mac: res.mac,
                    netmask: '255.255.255.248',
                    network_uuid: net.uuid,
                    nic_tag: net.nic_tag,
                    owner_uuid: params.owner_uuid,
                    primary: false,
                    resolvers: net.resolvers,
                    vlan_id: net.vlan_id
                }, 'result for ' + nextIP);

                return cb();
            });
        },
        function () {
            // Both networks should now be exhausted of IPs and should return
            // an error accordingly

            var params = {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid:  mod_uuid.v4()
            };

            NAPI.provisionNic(POOL1.uuid, params, function (err, res) {
                t.ok(err);
                if (!err) {
                    return t.done();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, helpers.invalidParamErr({
                    errors: [ mod_err.invalidParam('network_uuid',
                                        constants.POOL_FULL_MSG) ]
                }), 'error body');

                return t.done();
            });
        });
};



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
