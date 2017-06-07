/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * Test helpers for testing fabrics
 */

'use strict';

var assert = require('assert-plus');
var h = require('../integration/helpers');
var test = require('tape');



// --- Globals



var ENABLED = false;
var CHECKED = false;
var SKIP_TESTS = (process.env.NAPITEST_SKIP_FABRICS === 'true');



/**
 * Check if fabrics are enabled using the /ping endpoint
 */
function checkIfEnabled(callback) {
    if (CHECKED) {
        setImmediate(callback, null, ENABLED);
        return;
    }

    var client = h.createNAPIclient();
    client.ping(function _afterPing(err, res) {
        CHECKED = true;

        if (err) {
            callback(err);
            return;
        }

        assert.object(res.config, 'res.config');
        assert.bool(res.config.fabrics_enabled, 'res.config.fabrics_enabled');

        ENABLED = res.config.fabrics_enabled;

        callback(null, ENABLED);
    });
}


/**
 * A wrapper around tape's test that only runs tests if fabrics are enabled.
 * Note that due to test() not being called on this tick (since
 * checkIfEnabled() runs first), these tests will show up *after* the other
 * high-level tests run.
 */
function testIfFabricsEnabled(testName, testFunc) {
    assert.string(testName, 'testName');
    assert.func(testFunc, 'testFunc');

    test(testName, function (t) {
        checkIfEnabled(function _afterCheck(err, enabled) {
            if (err) {
                t.ifErr(err, 'ping error - skipping test');
                t.end();
                return;
            }

            if (enabled) {
                testFunc(t);
            } else {
                t.ok(SKIP_TESTS, 'fabrics not enabled - skipping test');
                t.end();
            }
        });
    });
}



module.exports = {
    testIfEnabled: testIfFabricsEnabled
};
