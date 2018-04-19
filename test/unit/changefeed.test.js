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

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var LOG = require('../lib/log');
var mod_aggr = require('../lib/aggr');
var mod_changefeed = require('changefeed');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
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
            'delete',
            'allow_dhcp_spoofing',
            'allow_ip_spoofing',
            'allow_mac_spoofing',
            'allow_restricted_traffic',
            'allow_unfiltered_promisc',
            'primary'
        ]
    },
    {
        resource: 'nic_tag',
        subResources: [
            'create',
            'delete'
        ]
    },
    {
        resource: 'aggregation',
        subResources: [
            'create',
            'delete',
            'lacp_mode'
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
            if (++count === CF_RESOURCES.length) {
                t2.end();
            }
        });

        FEED.register();
    });
});


// --- Tests

test('nic_tag/network events', function (t) {
    t.test('create nic tag', function (t2) {
        mod_nic_tag.create(t2, {
            // Match the name of the nic tag in h.validNetworkParams()
            name: 'nic_tag',
            partialExp: {
                name: 'nic_tag'
            }
        }, function (_, res) {
            TAG = res;
            t2.end();
        });
    });

    t.test('check create nic_tag event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'nic_tag',
                subResources: [ 'create' ]
            }, 'nic_tag create event');
            t2.deepEqual(evt.changedResourceId, TAG.name);
            t2.ok(evt.etag);
            t2.ok(evt.published);

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

    t.test('check create network event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'network',
                subResources: [ 'create' ]
            }, 'network create event');
            t2.deepEqual(evt.changedResourceId, NET.uuid);
            t2.ok(evt.etag);
            t2.ok(evt.published);

            t2.end();
        });
    });
});


test('nic events', function (t) {
    var cn_uuid = mod_uuid.v4();
    var aggrId = mod_aggr.id(cn_uuid, 'aggr1');
    var mac = '01:23:45:67:89:ab';
    var params = {
        belongs_to_uuid: cn_uuid,
        belongs_to_type: 'server',
        owner_uuid: constants.UFDS_ADMIN_UUID,
        cn_uuid: cn_uuid,
        network_uuid: NET.uuid
    };

    t.test('create nic', function (t2) {
        mod_nic.create(t2, {
            mac: mac,
            params: params,
            partialExp: params
        });
    });

    t.test('check for create nic event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'nic',
                subResources: [ 'create' ]
            }, 'nic create event');
            t2.deepEqual(evt.changedResourceId, mac, 'has correct mac');
            t2.ok(evt.etag, 'has etag');
            t2.ok(evt.published, 'has published');

            t2.end();
        });
    });

    t.test('update nic', function (t2) {
        mod_nic.update(t2, {
            mac: mac,
            params: {
                allow_ip_spoofing: true,
                state: 'stopped'
            },
            partialExp: {
                allow_ip_spoofing: true,
                state: 'stopped'
            }
        });
    });

    t.test('check for update nic event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'nic',
                subResources: [
                    'allow_ip_spoofing',
                    'state'
                ]
            }, 'nic create event');
            t2.deepEqual(evt.changedResourceId, mac, 'has correct mac');
            t2.deepEqual(evt.cn_uuid, params.cn_uuid, 'has cn_uuid');
            t2.ok(evt.etag, 'has etag');
            t2.ok(evt.published, 'has published');

            t2.end();
        });
    });

    t.test('create aggr', function (t2) {
        mod_aggr.create(t2, {
            params: {
                name: 'aggr1',
                macs: [ mac ]
            },
            exp: {
                id: aggrId,
                belongs_to_uuid: cn_uuid,
                lacp_mode: 'off',
                macs: [ mac ],
                name: 'aggr1'
            }
        });
    });

    t.test('check for create aggr event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'aggregation',
                subResources: [ 'create' ]
            }, 'aggr create event');
            t2.deepEqual(evt.changedResourceId, aggrId);
            t2.deepEqual(evt.belongs_to_uuid, cn_uuid);
            t2.deepEqual(evt.name, 'aggr1');
            t2.ok(evt.etag);
            t2.ok(evt.published);

            t2.end();
        });
    });

    t.test('update aggr', function (t2) {
        mod_aggr.update(t2, {
            id: aggrId,
            params: {
                lacp_mode: 'active'
            },
            exp: {
                id: aggrId,
                belongs_to_uuid: cn_uuid,
                lacp_mode: 'active',
                macs: [ mac ],
                name: 'aggr1'
            }
        });
    });

    t.test('check for update aggr event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'aggregation',
                subResources: [ 'lacp_mode' ]
            }, 'aggr update event');
            t2.deepEqual(evt.changedResourceId, aggrId);
            t2.deepEqual(evt.belongs_to_uuid, cn_uuid);
            t2.deepEqual(evt.name, 'aggr1');
            t2.ok(evt.etag);
            t2.ok(evt.published);

            t2.end();
        });
    });

    t.test('delete aggr', function (t2) {
        mod_aggr.del(t2, { id: aggrId });
    });

    t.test('check for delete aggr event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'aggregation',
                subResources: [ 'delete' ]
            }, 'aggr delete event');
            t2.deepEqual(evt.changedResourceId, aggrId);
            t2.deepEqual(evt.belongs_to_uuid, cn_uuid);
            t2.deepEqual(evt.name, 'aggr1');
            t2.ok(evt.published);

            t2.end();
        });
    });

    t.test('delete nic', function (t2) {
        mod_nic.del(t2, { mac: mac });
    });

    t.test('check for delete nic event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'nic',
                subResources: [ 'delete' ]
            }, 'nic create event');
            t2.deepEqual(evt.changedResourceId, mac, 'has correct mac');
            t2.deepEqual(evt.cn_uuid, params.cn_uuid, 'has cn_uuid');
            t2.ok(evt.published, 'has published');

            t2.end();
        });
    });
});


test('nic_tag/network delete events', function (t) {
    t.test('delete network', function (t2) {
        mod_net.del(t2, { uuid: NET.uuid });
    });

    t.test('check delete network event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'network',
                subResources: [ 'delete' ]
            }, 'network delete event');
            t2.deepEqual(evt.changedResourceId, NET.uuid);
            t2.ok(evt.published);

            t2.end();
        });
    });

    t.test('delete nic tag', function (t2) {
        mod_nic_tag.del(t2, { name: TAG.name });
    });

    t.test('check delete nic_tag event', function (t2) {
        FEED.once('readable', function () {
            var evt = FEED.read();

            t2.deepEqual(evt.changeKind, {
                resource: 'nic_tag',
                subResources: [ 'delete' ]
            }, 'nic_tag delete event');
            t2.deepEqual(evt.changedResourceId, TAG.name);
            t2.ok(evt.published);

            t2.end();
        });
    });
});


// --- Teardown

test('Stop listener', function (t) {
    FEED.close();
    t.end();
});

test('Stop server', mod_server.close);
