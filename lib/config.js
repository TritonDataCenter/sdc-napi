/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI config file loading and validation
 */

'use strict';

var assert = require('assert-plus');
var fs = require('fs');



/**
 * Validate the config
 */
function validateConfig(config) {
    assert.string(config.datacenter, 'datacenter (Datacenter name)');
    assert.string(config.macOUI,
            'macOUI (MAC address OUI for provisioning nics');
    assert.optionalNumber(config.maxHttpSockets,
            'maxHttpSockets (maximum open connections)');
    assert.number(config.port, 'port (port number)');
    assert.string(config.ufdsAdminUuid, 'ufdsAdminUuid (admin user uuid)');

    assert.object(config.moray, 'moray (moray config section)');
    assert.string(config.moray.host, 'moray.host (moray IP)');
    assert.number(config.moray.port, 'moray.port (moray port number)');

    assert.object(config.overlay, 'overlay (overlay config section)');
}



// --- Exports



/**
 * Loads the NAPI config from configFile (and throws an error if the config
 * is incomplete / invalid)
 */
function loadConfig(configFile) {
    assert.string(configFile, 'configFile');
    var config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    validateConfig(config);

    return config;
}


module.exports = {
    load: loadConfig
};
