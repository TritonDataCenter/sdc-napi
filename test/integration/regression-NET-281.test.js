/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2015, Joyent, Inc.
 */

/*
 * Regression test for NET-281. We need to make requests that have invalid JSON
 * payloads and verify that we receive a 4xx class error.
 *
 * Note, we only test top-level routes at the moment so as to ensure that if
 * this crashes, we don't leave around any garbage. It's also simplest to test
 * POST here, as that will actually allow the server to be accepting a JSON body
 * payload.
 *
 * Note, we only use the simple RestifyClient as opposed to any fancier
 * versions on purpose. This allows us to ensure that we can send out malformed
 * JSON.
 */

'use strict';

var config = require('../lib/config');
var mod_restify = require('restify');
var test = require('tape');

var reg_routes = [
    '/nic_tags',
    '/networks',
    '/nics',
    '/network_pools',
    '/aggregations'
];

var reg_client = mod_restify.createClient({
    url: config.napi.host,
    accept: 'application/json',
    headers: { 'content-type': 'application/json' }
});

/*
 * Test a single route.
 */
function regTestOne(route, t) {
    t.test('Get 400 on JSON post to ' + route, function (t2) {
        reg_client.post(route, function (err, req) {
            t2.error(err);
            req.on('result', function (error, res) {
                t2.ok(error, 'got error');
                t2.equal(error.statusCode, 400, 'got 400');
                req.abort();
                t2.end();
            });

            req.write('foo=bar');
            req.end();
        });
    });
}

function main() {
    var i;
    for (i = 0; i < reg_routes.length; i++) {
        test.test(regTestOne.bind(null, reg_routes[i]));
    }
}

main();
