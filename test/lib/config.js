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

var fmt = require('util').format;



// --- Globals



var NAPI_HOST = process.env.NAPI_HOST || 'localhost';
var NAPI_PORT = process.env.NAPI_PORT || 80;



// --- Exports


// XXX: Allow overriding these values with config.json!
var CONFIG = {
    moray: {
        host: process.env.MORAY_HOST || '10.99.99.17',
        port: process.env.MORAY_PORT || 2020
    },
    napi: {
        host: fmt('http://%s:%d', NAPI_HOST, NAPI_PORT)
    }
};



module.exports = CONFIG;
