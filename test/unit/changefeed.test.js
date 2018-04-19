/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for network endpoints
 */

'use strict';

var h = require('./helpers');
var LOG = require('../lib/log');
var mod_changefeed = require('changefeed');
var mod_net = require('../lib/net');
var mod_nic_tag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var test = require('tape');


// --- Globals

var FEED;
var MORAY;
var NAPI;
var NET;
var TAG;

var INSTUUID = mod_uuid.v4();

var CF_RESOURCES = [
    {
        resource: 'network',
        subResources: [
            'create',
            'delete',
            'gateway',
            'resolvers',
            'routes'
        ]
    },
    {
        resource: 'nic',
        subResources: [
            'create',
            'delete'
        ]
    }
];

// --- Setup

test('Initial setup', function (t) {
    h.reset();

    t.test('setup client and server', function (t2) {
        h.createClientAndServer(function (err, res, moray) {
            NAPI = res;
            MORAY = moray;

            t2.ifError(err, 'server creation');
            t2.ok(NAPI, 'have NAPI client object');
            t2.ok(MORAY, 'have MORAY client object');
            t2.end();
        });
    });

    t.test('setup listener', function (t2) {
        var count = 0;

        t2.plan(CF_RESOURCES.length);

        FEED = mod_changefeed.createListener({
            log: LOG,
            url: 'http://localhost:' + NAPI.client.url.port,
            instance: INSTUUID,
            service: 'napi-tests',
            resources: CF_RESOURCES,
            backoff: {
                maxTimeout: 10000,
                minTimeout: 2000,
                retries: Infinity
            }
        });
        FEED.on('bootstrap', function (bs) {
            t2.ok(bs, 'bootstrap object returned');
            if (++count == CF_RESOURCES.length) {
                t2.end();
            }
        });
        FEED.register();
    });

    t.test('create nic tag', function (t2) {
        // Match the name of the nic tag in h.validNetworkParams()
        mod_nic_tag.create(t2, {
            name: 'nic_tag',
            partialExp: {
                name: 'nic_tag'
            }
        }, function (_, res) {
            TAG = res;
            t2.end();
        });
    });

    t.test('create network', function (t2) {
        mod_net.create(t2, {
            params: h.validNetworkParams(),
            partialExp: {
                family: 'ipv4'
            }
        }, function (_, res) {
            NET = res;
            t2.end();
        });
    });
});


// --- Tests

test('check for create network event', function (t) {
    FEED.on('readable', function () {
        var evt = FEED.read();
        console.log(evt);
        t.end();
    });
});




// --- Teardown

test('Stop listener', function (t) {
    FEED.close();
    t.end();
});

test('Stop server', mod_server.close);
