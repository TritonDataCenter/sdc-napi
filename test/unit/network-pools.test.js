/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Unit tests for nic endpoints
 */

var async = require('async');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_moray = require('../lib/moray');
var mod_net = require('../lib/net');
var mod_tag = require('../lib/nic-tag');
var mod_pool = require('../lib/pool');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util = require('util');



// --- Globals



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


function createNet(t, extra) {
    if (!extra) {
        extra = {};
    }

    NAPI.createNetwork(netParams(extra), function (err, res) {
        t.ifErr(err);
        if (res) {
            NETS.push(res);
        }

        return t.end();
    });
}



// --- Setup



test('Initial setup', function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.end();
        }

        var net1Params = netParams({
            subnet: '10.0.0.0/28',
            provision_start_ip: '10.0.0.2',
            provision_end_ip: '10.0.0.5'
        });
        var otherTag = 'othertag' + process.pid;

        t.test('delete previous', function (t2) {
            mod_pool.delAll(t2, {});
        });

        t.test('create nic tag 1', function (t2) {
            mod_tag.create(t2, { name: net1Params.nic_tag });
        });

        t.test('create other nic tag', function (t2) {
            mod_tag.create(t2, { name: otherTag });
        });

        t.test('create net0', function (t2) {
            NAPI.createNetwork(net1Params, function (err2, res2) {
                t2.ifErr(err2);
                if (res2) {
                    NETS.push(res2);
                }

                return t.end();
            });
        });

        t.test('create net1', function (t2) {
            createNet(t2);
        });

        t.test('create net2', function (t2) {
            createNet(t2);
        });

        t.test('create net3', function (t2) {
            createNet(t2, { nic_tag: otherTag });
        });

        t.test('create net4', function (t2) {
            createNet(t2);
        });

        t.test('create net5', function (t2) {
            createNet(t2);
        });

        t.test('create pool1', function (t2) {
            var name = 'pool1-' + process.pid;
            var params = {
                networks: [ NETS[0].uuid, NETS[1].uuid, NETS[2].uuid ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                t.ifErr(err2);
                if (!err2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[0].nic_tag;
                    t2.deepEqual(res2, params, 'result');
                }

                return t2.end();
            });
        });

        t.test('create pool2', function (t2) {
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
                    t2.deepEqual(res2, params, 'result');
                }

                return t2.end();
            });
        });
    });
});



// --- Create tests



test('Create pool - non-existent network', function (t) {
    var params = {
        networks: [ NETS[0].uuid, mod_uuid.v4() ]
    };
    NAPI.createNetworkPool('pool-fail-1-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        var unknownParam = mod_err.invalidParam('networks', 'unknown network');
        unknownParam.invalid = [ params.networks[1] ];

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ unknownParam ]
        }), 'error body');

        return t.end();
    });
});


test('Create pool - too many networks', function (t) {
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
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                'maximum 64 networks per network pool') ]
        }), 'error body');

        return t.end();
    });
});


test('Create pool - mismatched nic tags', function (t) {
    var params = {
        networks: [ NETS[0].uuid, NETS[3].uuid ]
    };

    NAPI.createNetworkPool('pool-fail-2-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_TAGS_MATCH_MSG) ]
        }), 'error body');

        return t.end();
    });
});



// --- Update tests



test('Update non-existent pool', function (t) {
    var params = {
        networks: [ NETS[0].uuid ]
    };

    NAPI.updateNetworkPool(mod_uuid.v4(), params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network pool not found'
        }, 'error body');

        return t.end();
    });
});


test('Update pool', function (t) {
    var params = {
        networks: [ NETS[0].uuid, NETS[1].uuid ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        POOLS[0].networks = params.networks;
        t.deepEqual(res, POOLS[0], 'updated result');
        return t.end();
    });
});


test('Update pool: no networks', function (t) {
    var params = {
        networks: [ ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_MIN_NETS_MSG) ]
        }), 'error body');

        return t.end();
    });
});


test('Update pool: remove owner_uuids', function (t) {
    t.plan(4);

    var params = {
        owner_uuids: [ ]
    };

    t.test('update', function (t2) {
        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'update pool')) {
                return t2.end();
            }

            delete POOLS[1].owner_uuids;
            t2.deepEqual(res, POOLS[1], 'owner_uuids removed');

            var morayObj = mod_moray.getObj('napi_network_pools',
                POOLS[1].uuid);

            t2.ok(!morayObj.hasOwnProperty('owner_uuids'),
                'owner_uuids property no longer present in moray');
            return t2.end();
        });
    });

    t.test('get', function (t2) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t2, err, 'get pool')) {
                return t2.end();
            }

            t2.deepEqual(res, POOLS[1], 'get result');
            return t2.end();
        });
    });

    t.test('update owner_uuids', function (t2) {
        params.owner_uuids = [ mod_uuid.v4(), mod_uuid.v4() ];

        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'update pool')) {
                return t2.end();
            }

            POOLS[1].owner_uuids = params.owner_uuids.sort();
            t2.deepEqual(res, POOLS[1], 'owner_uuids added');

            var morayObj = mod_moray.getObj('napi_network_pools',
                POOLS[1].uuid);
            t2.ok(morayObj, 'got moray object');

            t2.equal(morayObj.owner_uuids, ','
                + params.owner_uuids.sort().join(',') + ',',
                'owner_uuids updated in moray');
            return t2.end();
        });
    });

    t.test('second get', function (t2) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t2, err, 'get pool')) {
                return t2.end();
            }

            t2.deepEqual(res, POOLS[1], 'get result');
            return t2.end();
        });
    });
});



// --- Get tests



test('Get pool', function (t) {
    NAPI.getNetworkPool(POOLS[0].uuid, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        t.deepEqual(res, POOLS[0], 'get result');
        return t.end();
    });
});


test('provisionable_by network pools: owner', function (t) {
    t.plan(5);

    var net;
    var owners = [];
    var pool;

    t.test('create network', function (t2) {
        owners = [ mod_uuid.v4(), mod_uuid.v4() ];
        var params = h.validNetworkParams({
            owner_uuids: [ owners[0] ]
        });

        mod_net.create(t2, {
            params: params,
            partialExp: params
        });
    });

    t.test('create', function (t2) {
        net = mod_net.lastCreated();
        t2.ok(net, 'Have last created network');

        var params = {
            networks: [ net.uuid ],
            owner_uuids: [ owners[0] ]
        };

        mod_pool.create(t2, {
            name: '<generate>',
            params: params,
            partialExp: params
        });
    });

    t.test('list', function (t2) {
        pool = mod_pool.lastCreated();
        t2.ok(pool, 'Have last created pool');
        POOLS.push(pool);

        mod_pool.list(t2, {
            params: {
                provisionable_by: owners[0]
            }
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(res.map(function (n) {
                    return n.uuid;
                }).indexOf(pool.uuid) !== -1,
                'pool in list');
            return t2.end();
        });
    });

    t.test('get: provisionable_by owner', function (t2) {
        mod_pool.get(t2, {
            uuid: pool.uuid,
            params: {
                provisionable_by: owners[0]
            },
            exp: pool
        });
    });

    t.test('get: provisionable_by other', function (t2) {
        mod_pool.get(t2, {
            uuid: pool.uuid,
            params: {
                provisionable_by: owners[1]
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });
});



// --- List tests



test('List pools', function (t) {
    NAPI.listNetworkPools(function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        var sorted = clone(POOLS);
        sorted.sort(h.uuidSort);
        t.deepEqual(res.sort(h.uuidSort), sorted, 'list result');
        return t.end();
    });
});



// --- Provisioning tests



test('Provision nic - on network pool with IP', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: NETS[1].provision_start_ip,
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(POOLS[0].uuid, params, function (err, res) {
        t.ok(err);
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('ip', constants.POOL_IP_MSG) ]
        }), 'error body');

        return t.end();
    });
});


test('Provision nic - on network pool', function (t) {
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
                    state: 'running',
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
                    return t.end();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, h.invalidParamErr({
                    errors: [ mod_err.invalidParam('network_uuid',
                                        constants.POOL_FULL_MSG) ]
                }), 'error body');

                return t.end();
            });
        });
});



// --- Delete tests



test('Delete network in pool', function (t) {
    NAPI.deleteNetwork(NETS[0].uuid, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
            code: 'InUse',
            message: 'Network is in use',
            errors: [ mod_err.usedBy('network pool', POOLS[0].uuid) ]
        }, 'error body');
        return t.end();
    });
});



// --- Teardown



test('Stop server', function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
