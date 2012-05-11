/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * The Networking API control application
 */

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var format = require('util').format;

var nopt = require('nopt');
var NAPI = require('sdc-clients').NAPI;
var bunyan = require('bunyan');
var restify = require('restify');


var VERBOSE = false;
var DEBUG = false;
var LONG_OPTS = {
  'verbose': Boolean,
  'debug': Boolean
};
var SHORT_OPTS = {
  'v': '--verbose',
  'd': '--debug'
};


/*
 * Main entry point
 */
function main() {
  var parsedOpts = nopt(LONG_OPTS, SHORT_OPTS, process.argv, 2);
  var command = parsedOpts.argv.remain[0];
  if (parsedOpts.verbose)
    VERBOSE = true;
  if (parsedOpts.debug)
    DEBUG = true;

  var config = loadConfig();
  var napi = new NAPI({
    url: "http://localhost:" + config.port,
    username: config.user,
    password: config.password
  });

  switch (command) {
  case 'ping':
    napi.ping(standardHandler);
    break;
  // Nics
  case 'nic-list':
    listNics(napi, parsedOpts);
    break;
  case 'nics':
    getNics(napi, parsedOpts);
    break;
  case 'nic-get':
    getNic(napi, parsedOpts);
    break;
  case 'nic-update':
    updateNic(napi, parsedOpts);
    break;
  case 'nic-provision':
    provisionNic(napi, parsedOpts);
    break;
  case 'nic-create':
    createNic(napi, parsedOpts);
    break;
  // Networks
  case 'network-list':
    listNetworks(napi, parsedOpts);
    break;
  default:
    usage();
    break;
  }
}



//--- Utility functions



/*
 * Loads the config and validates it
 */
function loadConfig() {
  var configFile = path.normalize(__dirname + '/../config.json');
  var config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  var required = ['port', 'user', 'password'];
  for (var r in required) {
    var req = required[r];
    assert.ok(config.hasOwnProperty(req), "Config value '" + req + "' required.");
  }
  return config;
}


/*
 * Nicely formats a JSON object
 */
function json(obj) {
  return JSON.stringify(obj, null, 2);
}


/*
 * Generic handler for callbacks: prints out an error if there is one,
 * stringifies the JSON otherwise.
 */
function standardHandler(err, res) {
  if (err) {
    var code = '';
    if (VERBOSE) {
      code = err.code + ': ';
    }
    return console.error(code + err.message);
  }
  return console.log(json(res));
}


/*
 * Parses params in argv for key=val parameters, and returns them as a hash.
 */
function getKeyValParams(opts, idx) {
  var params = {};
  var errs = [];
  if (!idx) {
    idx = 0;
  }
  for (var i = idx; i < opts.argv.remain.length; i++) {
    var split = opts.argv.remain[i].split('=');
    if (split.length != 2) {
      errs.push(opts.argv.remain[i]);
      continue;
    }
    params[split[0]] = split[1];
  }

  if (errs.length != 0) {
    exit("Invalid update key%s: %s",
        (errs.length == 1 ? '' : 's'), errs.join(', '));
  }
  if (DEBUG) {
    console.error("command-line params: " + json(params));
  }

  return params;
}


/*
 * Prints out the usage statement
 */
function usage() {
  console.log('Usage: ' + path.basename(process.argv[1]).replace('.js', '') +
      ' <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('');
  console.log('ping');
  console.log('network-list');
  console.log('nic-get <MAC address>');
  console.log('nic-create <MAC address> [field=value ...]');
  console.log('nic-provision <Logical Network UUID> [field=value ...]');
  console.log('nic-update <MAC address> update_field=value ' +
      '[update_field2=value ...]');
  console.log('nic-list [filter_field=value ...]');
  console.log('nics <UUID of owner>');
}


/*
 * Exits with a message.
 */
function exit() {
  console.error.apply(null, Array.prototype.slice.apply(arguments));
  process.exit(1);
}



//--- Nic endpoints



/*
 * Gets a nic from NAPI
 */
function getNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit("Error: must supply MAC address!");
  }

  napi.getNic(macAddr, standardHandler);
}


/*
 * Lists all of the nics
 */
function listNics(napi, opts) {
  var params = getKeyValParams(opts, 1);
  napi.listNics(params, standardHandler);
}


/*
 * Lists all of the nics for a given owner
 */
function getNics(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit("Error: must supply UUID!");
  }
  napi.getNics(uuid, standardHandler);
}


/*
 * Updates a nic
 */
function updateNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit("Error: must supply MAC address!");
  }
  var params = getKeyValParams(opts, 2);
  if (Object.keys(params).length == 0) {
    exit("Must specify parameters to update!");
  }
  napi.updateNic(macAddr, params, standardHandler);
}


/*
 * Provisions a new nic in NAPI, with an IP address on the logical
 * network provided
 */
function provisionNic(napi, opts) {
  var network = opts.argv.remain[1];
  if (!network) {
    exit("Error: must supply logical network!");
  }
  var params = getKeyValParams(opts, 2);
  napi.provisionNic(network, params, standardHandler);
}


/*
 * Creates a new nic
 */
function createNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit("Error: must supply MAC address!");
  }
  var params = getKeyValParams(opts, 2);
  napi.createNic(macAddr, params, standardHandler);
}



// --- Network endpoints



/*
 * Lists all of the networks
 */
function listNetworks(napi, opts) {
  var params = getKeyValParams(opts, 1);
  napi.listNetworks(params, standardHandler);
}



main();
