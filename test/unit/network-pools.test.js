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
var NET3;
var NET4;
var POOL1;



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
        var otherTag = 'othertag' + process.pid;

        vasync.pipeline({
        funcs: [
            function _nicTag(_, cb) {
                NAPI.createNicTag(net1Params.nic_tag, cb);
            },

            function _nicTag2(_, cb) {
                NAPI.createNicTag(otherTag, cb);
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

            function _testNet3(_, cb) {
                var params = helpers.validNetworkParams({
                    name: 'net3',
                    provision_end_ip: '10.0.1.12',
                    provision_start_ip: '10.0.1.9',
                    subnet: '10.0.1.8/29',
                    uuid: 'ccc57862-54fa-4667-89ae-c981cd5ada9a'
                });

                NAPI.createNetwork(params, function (err3, res3) {
                    NET3 = res3;
                    cb(err3);
                });
            },

            function _testNet4(_, cb) {
                var params = helpers.validNetworkParams({
                    name: 'net4',
                    nic_tag: otherTag,
                    provision_end_ip: '10.0.1.12',
                    provision_start_ip: '10.0.1.9',
                    subnet: '10.0.1.8/29',
                    uuid: 'dddd7862-54fa-4667-89ae-c981cd5ada9a'
                });

                NAPI.createNetwork(params, function (err4, res4) {
                    NET4 = res4;
                    cb(err4);
                });
            },

            function _netPool1(_, cb) {
                var name = 'pool1-' + process.pid;
                var params = {
                    networks: [ NET1.uuid, NET2.uuid, NET3.uuid ]
                };

                NAPI.createNetworkPool(name, params, function (err2, res2) {
                    if (!err2) {
                        POOL1 = res2;
                        params.name = name;
                        params.uuid = res2.uuid;
                        params.nic_tag = NET1.nic_tag;
                        t.deepEqual(res2, params, 'result');
                    }
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



// --- Create tests



exports['Create pool - non-existent network'] = function (t) {
    var params = {
        networks: [ NET1.uuid, mod_uuid.v4() ]
    };
    NAPI.createNetworkPool('pool-fail-1-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        var unknownParam = mod_err.invalidParam('networks', 'unknown network');
        unknownParam.invalid = [ params.networks[1] ];

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ unknownParam ]
        }), 'error body');

        return t.done();
    });
};


exports['Create pool - too many networks'] = function (t) {
    var params = {
        networks: [ ]
    };
    for (var n = 0; n < 65; n++) {
        params.networks.push(mod_uuid.v4());
    }

    NAPI.createNetworkPool('pool-fail-1-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                'maximum 64 networks per network pool') ]
        }), 'error body');

        return t.done();
    });
};


exports['Create pool - mismatched nic tags'] = function (t) {
    var params = {
        networks: [ NET1.uuid, NET4.uuid ]
    };

    NAPI.createNetworkPool('pool-fail-2-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_TAGS_MATCH_MSG) ]
        }), 'error body');

        return t.done();
    });
};



// --- Update tests



exports['Update non-existent pool'] = function (t) {
    var params = {
        networks: [ NET1.uuid ]
    };

    NAPI.updateNetworkPool(mod_uuid.v4(), params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network pool not found'
        }, 'error body');

        return t.done();
    });
};


exports['Update pool'] = function (t) {
    var params = {
        networks: [ NET1.uuid, NET2.uuid ]
    };

    NAPI.updateNetworkPool(POOL1.uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        POOL1.networks = params.networks;
        t.deepEqual(res, POOL1, 'updated result');
        return t.done();
    });
};


exports['Update pool: no networks'] = function (t) {
    var params = {
        networks: [ ]
    };

    NAPI.updateNetworkPool(POOL1.uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_MIN_NETS_MSG) ]
        }), 'error body');

        return t.done();
    });
};



// --- Get tests



exports['Get pool'] = function (t) {
    NAPI.getNetworkPool(POOL1.uuid, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res, POOL1, 'get result');
        return t.done();
    });
};



// --- List tests



exports['List pools'] = function (t) {
    NAPI.listNetworkPools(function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res, [ POOL1 ], 'list result');
        return t.done();
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



// --- Delete tests



exports['Delete network in pool'] = function (t) {
    NAPI.deleteNetwork(NET1.uuid, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
            code: 'InUse',
            message: 'Network is in use',
            errors: [ mod_err.usedBy('network pool', POOL1.uuid) ]
        }, 'error body');
        return t.done();
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
