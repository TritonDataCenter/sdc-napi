/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var async = require('async');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var NETS = [];
var POOLS = [];



// --- Internal helpers


function netParams(extra) {
    if (!extra) {
        extra = {};
    }

    var l = NETS.length;
    var params = {
        name: 'net' + l,
        subnet: util.format('10.0.%d.0/28', l),
        provision_end_ip: util.format('10.0.%d.12', l),
        provision_start_ip: util.format('10.0.%d.9', l),
        // Ensure the networks sort in order of creation:
        uuid: util.format('%d%d%d%d7862-54fa-4667-89ae-c981cd5ada9a',
            l, l, l, l)
    };

    for (var e in extra) {
        params[e] = extra[e];
    }

    return h.validNetworkParams(params);
}


function createNet(extra, callback) {
    if (!callback) {
        callback = extra;
        extra = {};
    }

    NAPI.createNetwork(netParams(extra), function (err, res) {
        if (res) {
            NETS.push(res);
        }

        return callback(err);
    });
}



// --- Setup



exports['Initial setup'] = function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.done();
        }

        var net1Params = netParams({
            subnet: '10.0.0.0/28',
            provision_start_ip: '10.0.0.2',
            provision_end_ip: '10.0.0.5'
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

            function _testNet0(_, cb) {
                NAPI.createNetwork(net1Params, function (err2, res2) {
                    if (res2) {
                        NETS.push(res2);
                    }

                    cb(err2);
                });
            },

            function _testNet1(_, cb) {
                createNet(cb);
            },

            function _testNet2(_, cb) {
                createNet(cb);
            },

            function _testNet3(_, cb) {
                createNet({ nic_tag: otherTag }, cb);
            },

            function _testNet4(_, cb) {
                createNet(cb);
            },

            function _testNet5(_, cb) {
                createNet(cb);
            },

            function _netPool1(_, cb) {
                var name = 'pool1-' + process.pid;
                var params = {
                    networks: [ NETS[0].uuid, NETS[1].uuid, NETS[2].uuid ]
                };

                NAPI.createNetworkPool(name, params, function (err2, res2) {
                    if (!err2) {
                        POOLS.push(res2);
                        params.name = name;
                        params.uuid = res2.uuid;
                        params.nic_tag = NETS[0].nic_tag;
                        t.deepEqual(res2, params, 'result');
                    }

                    return cb(err2);
                });
            },

            function _netPool2(_, cb) {
                var name = 'pool2-' + process.pid;
                var params = {
                    networks: [ NETS[4].uuid, NETS[5].uuid ],
                    owner_uuids: [ mod_uuid.v4() ]
                };

                NAPI.createNetworkPool(name, params, function (err2, res2) {
                    if (!err2) {
                        POOLS.push(res2);
                        params.name = name;
                        params.uuid = res2.uuid;
                        params.nic_tag = NETS[4].nic_tag;
                        t.deepEqual(res2, params, 'result');
                    }

                    return cb(err2);
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
        networks: [ NETS[0].uuid, mod_uuid.v4() ]
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
        t.deepEqual(err.body, h.invalidParamErr({
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
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                'maximum 64 networks per network pool') ]
        }), 'error body');

        return t.done();
    });
};


exports['Create pool - mismatched nic tags'] = function (t) {
    var params = {
        networks: [ NETS[0].uuid, NETS[3].uuid ]
    };

    NAPI.createNetworkPool('pool-fail-2-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_TAGS_MATCH_MSG) ]
        }), 'error body');

        return t.done();
    });
};



// --- Update tests



exports['Update non-existent pool'] = function (t) {
    var params = {
        networks: [ NETS[0].uuid ]
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
        networks: [ NETS[0].uuid, NETS[1].uuid ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        POOLS[0].networks = params.networks;
        t.deepEqual(res, POOLS[0], 'updated result');
        return t.done();
    });
};


exports['Update pool: no networks'] = function (t) {
    var params = {
        networks: [ ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_MIN_NETS_MSG) ]
        }), 'error body');

        return t.done();
    });
};


exports['Update pool: remove owner_uuids'] = function (t) {
    var params = {
        owner_uuids: [ ]
    };

    vasync.pipeline({
    funcs: [
    function (_, cb) {
        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'update pool')) {
                return cb(err);
            }

            delete POOLS[1].owner_uuids;
            t.deepEqual(res, POOLS[1], 'owner_uuids removed');

            var morayObj =
                h.morayBuckets()['napi_network_pools'][POOLS[1].uuid];

            t.ok(!morayObj.hasOwnProperty('owner_uuids'),
                'owner_uuids property no longer present in moray');
            return cb();
        });

    }, function (_, cb) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t, err, 'get pool')) {
                return cb(err);
            }

            t.deepEqual(res, POOLS[1], 'get result');
            return cb();
        });

    }, function (_, cb) {
        params.owner_uuids = [ mod_uuid.v4(), mod_uuid.v4() ];

        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'update pool')) {
                return cb(err);
            }

            POOLS[1].owner_uuids = params.owner_uuids.sort();
            t.deepEqual(res, POOLS[1], 'owner_uuids added');

            var morayObj = h.morayObj('napi_network_pools', POOLS[1].uuid);
            t.ok(morayObj, 'got moray object');

            t.equal(morayObj.owner_uuids, ','
                + params.owner_uuids.sort().join(',') + ',',
                'owner_uuids property no longer present in moray');
            return cb();
        });

    }, function (_, cb) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t, err, 'get pool')) {
                return cb(err);
            }

            t.deepEqual(res, POOLS[1], 'get result');
            return cb();
        });

    } ] }, function () {
        return t.done();
    });
};



// --- Get tests



exports['Get pool'] = function (t) {
    NAPI.getNetworkPool(POOLS[0].uuid, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res, POOLS[0], 'get result');
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

        t.deepEqual(res, POOLS, 'list result');
        return t.done();
    });
};



// --- Provisioning tests



exports['Provision nic - on network pool with IP'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: NETS[1].provision_start_ip,
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(POOLS[0].uuid, params, function (err, res) {
        t.ok(err);
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('ip', constants.POOL_IP_MSG) ]
        }), 'error body');

        return t.done();
    });
};


exports['Provision nic - on network pool'] = function (t) {
    var earlyOutErr;

    // The "Update pool" test above changes POOLS[0] to have NETS[0] and
    // NETS[1] as its networks:
    var ipNums = [
        // NETS[0]: provisionable range of 10.0.0.2 -> 10.0.0.5
        '2', '3', '4', '5',
        // NETS[1]: provisionable range of 10.0.0.9 -> 10.0.0.12
        '9', '10', '11', '12'
    ];

    async.whilst(
        function () { return (!earlyOutErr && ipNums.length !== 0); },
        function (cb) {
            var client = h.createClient();
            var params = {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid:  mod_uuid.v4()
            };
            var nextIPnum = ipNums.shift();
            var nextIP = util.format('10.0.%d.%d',
                nextIPnum < 6 ? 0 : 1,
                nextIPnum);
            var desc = util.format(' %s (req_id=%s)', nextIP, client.req_id);

            client.provisionNic(POOLS[0].uuid, params, function (err, res) {
                if (h.ifErr(t, err, 'provisioning' + desc)) {
                    earlyOutErr = err;
                    return cb();
                }

                var net = nextIPnum < 6 ? NETS[0] : NETS[1];
                t.deepEqual(res, {
                    belongs_to_type: params.belongs_to_type,
                    belongs_to_uuid: params.belongs_to_uuid,
                    ip: nextIP,
                    mac: res.mac,
                    netmask: '255.255.255.240',
                    network_uuid: net.uuid,
                    nic_tag: net.nic_tag,
                    owner_uuid: params.owner_uuid,
                    primary: false,
                    resolvers: net.resolvers,
                    status: 'running',
                    vlan_id: net.vlan_id
                }, 'result for' + desc);

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

            NAPI.provisionNic(POOLS[0].uuid, params, function (err, res) {
                t.ok(err);
                if (!err) {
                    return t.done();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, h.invalidParamErr({
                    errors: [ mod_err.invalidParam('network_uuid',
                                        constants.POOL_FULL_MSG) ]
                }), 'error body');

                return t.done();
            });
        });
};



// --- Delete tests



exports['Delete network in pool'] = function (t) {
    NAPI.deleteNetwork(NETS[0].uuid, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
            code: 'InUse',
            message: 'Network is in use',
            errors: [ mod_err.usedBy('network pool', POOLS[0].uuid) ]
        }, 'error body');
        return t.done();
    });
};



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
