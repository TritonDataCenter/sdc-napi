/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI config file loading and validation
 */

var assert = require('assert-plus');
var fs = require('fs');
var util = require('util');



/*
 * Validate the config
 */
function validateConfig(config) {
  assert.string(config.datacenter, 'datacenter (Datacenter name)');
  assert.string(config.macOUI,
      'macOUI (MAC address OUI for provisioning nics');
  assert.number(config.port, 'port (port number)');
  assert.object(config.ufds, 'ufds (UFDS config section)');

  assert.string(config.ufds.url, 'ufds.url (UFDS url)');
  assert.string(config.ufds.bindDN, 'ufds.bindDN (DN to bind to)');
  assert.string(config.ufds.bindPassword, 'ufds.bindPassword (UFDS password)');
}


/*
 * Loads the NAPI config from configFile (and throws an error if the config
 * is incomplete / invalid)
 */
function loadConfig(configFile) {
  assert.string(configFile, 'configFile');
  var config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  validateConfig(config);
  config.ufds.baseDN = util.format('datacenter=%s, o=smartdc',
    config.datacenter);

  return config;
}


// --- Exports

module.exports = {
  load: loadConfig
};
