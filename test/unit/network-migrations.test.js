/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Unit tests for network endpoints
 */

var fmt = require('util').format;
var h = require('./helpers');
var mod_moray = require('../lib/moray');
var mod_net = require('../lib/net');
var test = require('tape');
var util = require('util');



// --- Globals



var NAPI;
var TAG;



// --- Setup



test('Initial setup', function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        if (!NAPI) {
            t.end();
        }

        // Match the name of the nic tag in h.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            t.ifError(err2);
            TAG = res2;
            t.end();
        });
    });
});



// --- Create tests



test('0 -> 2', function (t) {
    var networks = [];
    var endIPs = [];

    t.test('create: 1', function (t2) {
        var params = h.validNetworkParams();

        mod_net.createAndGet(t2, {
            params: params,
            partialExp: params,
            state: { networks: networks }
        });
    });

    t.test('create: 2', function (t2) {
        var params = h.validNetworkParams();

        mod_net.createAndGet(t2, {
            params: params,
            partialExp: params,
            state: { networks: networks }
        });
    });

    t.test('remove subnet_end_ip from networks', function (t2) {
        // Networks from previous versions are missing values for v and
        // subnet_end_ip
        var netBucket = mod_moray.getBucket('napi_networks');
        for (var n in networks) {
            var net = netBucket[networks[n].uuid];
            t2.ok(net, 'network in moray: ' + networks[n].uuid);
            endIPs.push(net.value.subnet_start_ip
                + Math.pow(2, 32 - net.value.subnet_bits) - 1);

            t2.ok(net.value.subnet_end_ip, 'subnet_end_ip in moray');
            t2.ok(net.value.v, 'v in moray');
            delete net.value.v;
        }

        var schema = mod_moray.getBucketSchema('napi_networks');
        t2.ok(schema, 'got napi_networks schema');

        // version 1 = "schema update done, but migrations haven't been run".
        // After migration, it should move to 2.
        schema.options.version = 1;

        return t2.end();
    });

    // Make sure that we can still get the networks even though they have
    // subnet_end_ip removed
    t.test('get: 1', function (t2) {
        mod_net.get(t2, {
            uuid: networks[0].uuid,
            exp: networks[0]
        });
    });

    t.test('get: 2', function (t2) {
        mod_net.get(t2, {
            uuid: networks[1].uuid,
            exp: networks[1]
        });
    });

    t.test('run migration', function (t2) {
        h.server.doMigrations(function (err) {
            h.ifErr(t2, err, 'migrations');
            return t2.end();
        });
    });

    t.test('Check moray values after migration', function (t2) {
        var netBucket = mod_moray.getBucket('napi_networks');
        for (var n in networks) {
            var net = netBucket[networks[n].uuid];
            t2.ok(net, 'network in moray: ' + networks[n].uuid);
            t2.equal(net.value.subnet_end_ip, endIPs[n],
                'network subnet_end_ip in moray: ' + networks[n].uuid);
            t2.equal(net.value.v, 2,
                'network v correct in moray: ' + networks[n].uuid);
        }

        var schema = mod_moray.getBucketSchema('napi_networks');
        t2.ok(schema, 'got napi_networks schema');
        t2.equal(schema.options.version, 2, 'schema version updated');
        return t2.end();
    });

});



// --- Teardown



test('Stop server', function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
