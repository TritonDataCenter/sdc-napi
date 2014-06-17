/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /network-pools endpoints
 */

var clone = require('clone');
var helpers = require('./helpers');
var mod_pool = require('../lib/pool');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var state = {
    pools: []
};



// --- Setup



/*
 * Tests whether or not a network pool is in the list
 */
function poolInList(t, pool, list) {
    var found = 0;
    for (var i = 0; i < list.length; i++) {
        var cur = list[i];
        if (cur.uuid == pool.uuid) {
            t.deepEqual(cur, pool, util.format('pool %s in list', pool.name));
            found++;
        }
    }

    t.equal(found, 1,
        util.format('found exactly 1 pool %s in list', pool.name));
}



// --- Setup



exports['create test nic tag'] = function (t) {
    helpers.createNicTag(t, napi, state);
};


exports['create test network'] = function (t) {
    helpers.createNetwork(t, napi, state);
};


exports['create test network 2'] = function (t) {
    helpers.createNetwork(t, napi, state, {}, 'network2');
};


exports['create test network 3'] = function (t) {
    helpers.createNetwork(t, napi, state, {}, 'network3');
};



// --- Tests



exports['POST /network_pools'] = {
    'first': function (t) {
        mod_pool.createAndGet(t, {
            name: '<generate>',
            params: {
                networks: [ state.network.uuid ].sort()
            },
            exp: {
                networks: [ state.network.uuid ].sort(),
                nic_tag: state.network.nic_tag
            },
            state: state
        });
    },

    'second': function (t) {
        mod_pool.createAndGet(t, {
            name: '<generate>',
            params: {
                networks: [ state.network.uuid, state.network2.uuid ].sort()
            },
            exp: {
                networks: [ state.network.uuid, state.network2.uuid ].sort(),
                nic_tag: state.network.nic_tag
            },
            state: state
        });
    }
};


exports['GET /network_pools'] = function (t) {
    napi.listNetworkPools(function (err, res) {
        t.ifError(err, 'get network pools');

        poolInList(t, state.pools[0], res);
        poolInList(t, state.pools[1], res);

        var uuids = res.map(function (p) {
            return p.uuid;
        });
        var sorted = clone(uuids);
        sorted.sort();

        t.deepEqual(uuids, sorted, 'results returned sorted by UUIDs');
        return t.done();
    });
};


exports['PUT /network_pools/:uuid'] = function (t) {
    var params = {
        name: 'network_pool2' + process.pid,
        networks: [ state.network.uuid, state.network3.uuid ].sort()
    };

    napi.updateNetworkPool(state.pools[0].uuid, params, function (err, res) {
        t.ifError(err, 'update test network pool: ' + params.uuid);
        if (err) {
            return t.done();
        }

        params.uuid = state.pools[0].uuid;
        params.nic_tag = state.network.nic_tag;
        t.deepEqual(res, params, 'update params');

        return napi.getNetworkPool(res.uuid, function (err2, res2) {
            t.ifError(err, 'get network pool: ' + params.uuid);
            if (err) {
                return t.done();
            }

            t.deepEqual(res2, params, 'get params for ' + params.uuid);
            return t.done();
        });
    });
};


exports['DELETE /network-pools/:uuid'] = function (t) {
    vasync.forEachParallel({
        inputs: state.pools,
        func: function (pool, cb) {
            napi.deleteNetworkPool(pool.uuid, function (err) {
                t.ifError(err, 'delete test network pool ' + pool.name);
                cb(err);
            });
        }
    }, function (err, res) {
        return t.done();
    });
};



// --- Teardown



exports['remove test network'] = function (t) {
    helpers.deleteNetwork(t, napi, state);
};

exports['remove test network 2'] = function (t) {
    helpers.deleteNetwork(t, napi, state, 'network2');
};

exports['remove test network 3'] = function (t) {
    helpers.deleteNetwork(t, napi, state, 'network3');
};

exports['remove test nic tag'] = function (t) {
    helpers.deleteNicTag(t, napi, state);
};
