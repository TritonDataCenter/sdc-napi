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

var assert = require('assert-plus');
var fs = require('fs');
var util = require('util');



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

    assert.object(config.wfapi, 'wfapi (workflow API config section)');
    assert.optionalBool(config.wfapi.forceReplace,
        'wfapi.forceReplace (workflow API replace workflows flag)');
    assert.optionalBool(config.wfapi.forceReplace,
        'wfapi.forceReplace (workflow API replace workflows flag)');
    assert.object(config.wfapi.retry,
        'wfapi.retry (workflow API retry settings section)');
    assert.number(config.wfapi.retry.maxTimeout,
        'wfapi.retry.maxTimeout (workflow API retry max timeout setting)');
    assert.number(config.wfapi.retry.minTimeout,
        'wfapi.retry.minTimeout (workflow API retry min timeout setting)');

    if (!config.wfapi.retry.hasOwnProperty('retries') ||
        (typeof (config.wfapi.retry.retries) !== 'number' &&
            config.wfapi.retry.retries !== 'Infinity')) {
        assert.ok(false,
            'wfapi.retry.retries must be set to a number or "Infinity"');
    }
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

    // "Infinity" in a config evaluates to null when parsing JSON, so use
    // the string value instead:
    if (config.wfapi.retry.retries === 'Infinity' ||
        config.wfapi.retry.retries === null) {
        config.wfapi.retry.retries = Infinity;
    }

    return config;
}


module.exports = {
    load: loadConfig
};
