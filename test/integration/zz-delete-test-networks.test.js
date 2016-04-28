/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Delete all networks created during tests - useful to run if you have
 * tests that crash half-way through
 */

'use strict';

var common = require('../lib/common');
var fmt = require('util').format;
var h = require('./helpers');
var test = require('tape');
var vasync = require('vasync');



// --- Globals



var NAPI = h.createNAPIclient();
// Regexes that match the network name:
var NET_REs = [
    /^test-fabric-net\d-\d+$/,
    /^test-overlap-net\d-\d+$/,
    /^network-integration-\d+-\d$/,
    /^integration-overlap-testing/,
    /^test-net\d-\d+$/
];
var POOL_REs = [
    /^pool\d-\d+$/,
    /^test-pool\d-\d+$/
];


test('delete test network pools', function (t) {
    NAPI.listNetworkPools({}, function (err, pools) {
        if (h.ifErr(t, err, 'listing')) {
            return t.end();
        }

        if (pools.length === 0) {
            t.ok(true, 'No network pools found');
            return t.end();
        }

        var deleted = [];
        var toDel = [];
        var uuids = [];

        pools.forEach(function (pool) {
            var uuid = pool.uuid;

            POOL_REs.forEach(function (re) {
                if (pool.name.match(re) && uuids.indexOf(uuid) === -1) {
                    toDel.push(pool);
                }
            });
        });

        if (toDel.length === 0) {
            t.ok(true, 'No test network pools found');
            return t.end();
        }

        vasync.forEachParallel({
            inputs: toDel,
            func: function _delPool(pool, cb) {
                var desc = fmt('delete: uuid=%s, name=%s',
                    pool.uuid, pool.name);
                NAPI.deleteNetworkPool(pool.uuid,  {}, common.reqOpts(t, desc),
                        function _afterPoolDel(dErr) {
                    if (h.ifErr(t, dErr, desc)) {
                        return cb();
                    }

                    t.ok(true, desc + ' deleted');
                    deleted.push(pool);
                    return cb();
                });
            }
        }, function () {
            t.equal(deleted.length, toDel.length,
                'all test network pools deleted');
            return t.end();
        });
    });
});


test('delete test networks', function (t) {
    NAPI.listNetworks({}, function (err, nets) {
        if (h.ifErr(t, err, 'listing')) {
            return t.end();
        }

        if (nets.length === 0) {
            t.ok(true, 'No networks found');
            return t.end();
        }

        var deleted = [];
        var toDel = [];
        var uuids = [];

        nets.forEach(function (net) {
            var uuid = net.uuid;

            NET_REs.forEach(function (re) {
                if (net.name.match(re) && uuids.indexOf(uuid) === -1) {
                    toDel.push(net);
                }
            });
        });

        if (toDel.length === 0) {
            t.ok(true, 'No test networks found');
            return t.end();
        }

        vasync.forEachParallel({
            inputs: toDel,
            func: function _delNet(net, cb) {
                NAPI.listNics({
                    network_uuid: net.uuid
                }, function (listErr, nics) {
                    var descr = fmt('list: network_uuid=%s', net.uuid);
                    if (h.ifErr(t, listErr, descr)) {
                        return cb();
                    }
                    vasync.forEachParallel({
                        inputs: nics,
                        func: function _delNic(nic, niccb) {
                            NAPI.deleteNic(nic.mac, niccb);
                        }
                    }, function () {
                        var desc = fmt('delete: uuid=%s, name=%s',
                                net.uuid, net.name);
                        NAPI.deleteNetwork(net.uuid,  {},
                                common.reqOpts(t, desc),
                                function _afterDelNet(dErr) {
                            if (h.ifErr(t, dErr, desc)) {
                                return cb();
                            }

                            t.ok(true, desc + ' deleted');
                            deleted.push(net);
                            return cb();
                        });
                    });
                });
            }
        }, function () {
            t.equal(deleted.length, toDel.length, 'all test networks deleted');
            return t.end();
        });
    });
});
