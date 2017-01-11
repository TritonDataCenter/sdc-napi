/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 * Copyright 2014 Patrick Mooney.  All rights reserved.
 */

'use strict';

var assert = require('assert');
var fs = require('fs');
var mod_server = require('../lib/server');
var path = require('path');
var test = require('tape');

function runTests(directory) {
    mod_server.MULTI_SUITE_RUN = true;

    fs.readdir(directory, function (err, files) {
        assert.ifError(err);
        files.filter(function (f) {
            return (/\.test\.js$/.test(f));
        }).map(function (f) {
            return (path.join(directory, f));
        }).forEach(require);

        test('Shutdown Postgres', function (t) {
            mod_server.stopPG();
            t.end();
        });
    });
}

// --- Run All Tests

(function main() {
    runTests(__dirname);
})();
