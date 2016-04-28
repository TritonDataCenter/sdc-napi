/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test configuration
 */

'use strict';

var clone = require('clone');
var fmt = require('util').format;
var fs = require('fs');



// --- Globals



var NAPI_HOST = process.env.NAPI_HOST || 'localhost';
var NAPI_PORT = process.env.NAPI_PORT || 80;



// --- Exports



// XXX: Allow overriding these values with config.json!
var CONFIG = {
    defaults: {
        // NIC tags max out at 31 chars.
        nic_tag_name: 'sdcnapitest_' + process.pid
    },
    moray: {
        host: process.env.MORAY_HOST || '10.99.99.17',
        logLevel: process.env.LOG_LEVEL || 'fatal',
        port: process.env.MORAY_PORT || 2020
    },
    napi: {
        host: fmt('http://%s:%d', NAPI_HOST, NAPI_PORT)
    },
    server: JSON.parse(fs.readFileSync(__dirname + '/../config.json'))
};

CONFIG.server.moray = clone(CONFIG.moray);


module.exports = CONFIG;
