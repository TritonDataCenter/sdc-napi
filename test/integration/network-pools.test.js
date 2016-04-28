/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Integration tests for /network-pools endpoints
 */

'use strict';

var clone = require('clone');
var h = require('./helpers');
var mod_pool = require('../lib/pool');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
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
        if (cur.uuid === pool.uuid) {
            t.deepEqual(cur, pool, util.format('pool %s in list', pool.name));
            found++;
        }
    }

    t.equal(found, 1,
        util.format('found exactly 1 pool %s in list', pool.name));
}



// --- Setup



test('create test nic tag', function (t) {
    h.createNicTag(t, napi, state);
});


test('create test network', function (t) {
    h.createNetwork(t, napi, state);
});


test('create test network 2', function (t) {
    h.createNetwork(t, napi, state, {}, 'network2');
});


test('create test network 3', function (t) {
    h.createNetwork(t, napi, state, {}, 'network3');
});



// --- Tests



test('POST /network_pools', function (t) {
    t.test('first', function (t2) {
        mod_pool.createAndGet(t2, {
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
    });

    t.test('second', function (t2) {
        mod_pool.createAndGet(t2, {
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
    });
});


test('GET /network_pools', function (t) {
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
        return t.end();
    });
});


test('PUT /network_pools/:uuid', function (t) {
    var params = {
        name: 'network_pool2' + process.pid,
        networks: [ state.network.uuid, state.network3.uuid ].sort()
    };

    napi.updateNetworkPool(state.pools[0].uuid, params, function (err, res) {
        t.ifError(err, 'update test network pool: ' + params.uuid);
        if (err) {
            return t.end();
        }

        params.uuid = state.pools[0].uuid;
        params.nic_tag = state.network.nic_tag;
        t.deepEqual(res, params, 'update params');

        return napi.getNetworkPool(res.uuid, function (err2, res2) {
            t.ifError(err2, 'get network pool: ' + params.uuid);
            if (err) {
                return t.end();
            }

            t.deepEqual(res2, params, 'get params for ' + params.uuid);
            return t.end();
        });
    });
});


test('DELETE /network-pools/:uuid', function (t) {
    vasync.forEachParallel({
        inputs: state.pools,
        func: function (pool, cb) {
            napi.deleteNetworkPool(pool.uuid, function (err) {
                t.ifError(err, 'delete test network pool ' + pool.name);
                cb(err);
            });
        }
    }, function (err, res) {
        t.ifError(err, 'deleting pools should succeed');
        t.end();
    });
});



// --- Teardown



test('remove test network', function (t) {
    h.deleteNetwork(t, napi, state);
});

test('remove test network 2', function (t) {
    h.deleteNetwork(t, napi, state, 'network2');
});

test('remove test network 3', function (t) {
    h.deleteNetwork(t, napi, state, 'network3');
});

test('remove test nic tag', function (t) {
    h.deleteNicTag(t, napi, state);
});
