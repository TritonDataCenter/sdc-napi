/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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
  assert.number(config.port, 'port (port number)');

  assert.object(config.moray, 'moray (moray config section)');
  assert.string(config.moray.host, 'moray.host (moray IP)');
  assert.number(config.moray.port, 'moray.port (moray port number)');
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
