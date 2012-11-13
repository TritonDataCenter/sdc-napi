/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * The Networking API control application
 */

var assert = require('assert');
var bunyan = require('bunyan');
var format = require('util').format;
var fs = require('fs');
var mod_config = require('./config');
var mod_nicTag = require('./models/nic-tag');
var mod_ufds = require('./ufds');
var NAPI = require('sdc-clients').NAPI;
var nopt = require('nopt');
var path = require('path');
var restify = require('restify');
var UUID = require('node-uuid');


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

  var config = mod_config.load(
    path.normalize(__dirname + '/../config.json'));
  var napi = new NAPI({
    url: 'http://localhost:' + config.port
  });

  switch (command) {
  // Debugging
  case 'ping':
    napi.ping(standardHandler);
    break;
  case 'ufds-test':
    ufdsTest(config, function (err, res) {
      if (err) {
        console.error(err.message);
      }
      console.log(json(res));
    });
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
  case 'nic-delete':
    deleteNic(napi, parsedOpts);
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
  case 'network-get':
    getNetwork(napi, parsedOpts);
    break;
  case 'network-create':
    createNetwork(napi, parsedOpts);
    break;
  case 'network-delete':
    deleteNetwork(napi, parsedOpts);
    break;
  // IPs
  case 'ip-list':
    listIPs(napi, parsedOpts);
    break;
  case 'ip-get':
    getIP(napi, parsedOpts);
    break;
  case 'ip-update':
    updateIP(napi, parsedOpts);
    break;
  // Nic Tags
  case 'nictag-list':
    listNicTags(napi, parsedOpts);
    break;
  case 'nictag-create':
    createNicTag(napi, parsedOpts);
    break;
  case 'nictag-get':
    getNicTag(napi, parsedOpts);
    break;
  case 'nictag-update':
    updateNicTag(napi, parsedOpts);
    break;
  case 'nictag-delete':
    deleteNicTag(napi, parsedOpts);
    break;
  default:
    usage();
    break;
  }
}



// --- Utility functions



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
function standardHandler(err, obj, req, res) {
  if (err) {
    var code = '';
    if (VERBOSE) {
      code = err.code + ': ';
      if (!err.code) {
        code = res.statusCode;
      }
      console.error('Status code: %d', res.statusCode);
    }
    return console.error(code + err.message);
  }
  if (VERBOSE) {
    console.log('Status code: %d', res.statusCode);
  }
  return console.log(json(obj));
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

  if (DEBUG) {
    console.error('command-line params: ' + json(params));
  }
  if (errs.length != 0) {
    exit('Invalid parameter%s: %s',
        (errs.length == 1 ? '' : 's'), errs.join(', '));
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
  console.log('network-list [filter-param=value ...]');
  console.log('network-get <uuid>');
  console.log('network-create [param=value ...]');
  console.log('network-delete <uuid>');
  console.log('');
  console.log('nic-get <MAC address>');
  console.log('nic-create <MAC address> [field=value ...]');
  console.log('nic-provision <Logical Network UUID> [field=value ...]');
  console.log('nic-update <MAC address> update_field=value ' +
      '[update_field2=value ...]');
  console.log('nic-delete <MAC address>');
  console.log('nic-list [filter_field=value ...]');
  console.log('nics <UUID of owner>');
  console.log('');
  console.log('ip-list <Logical Network UUID>');
  console.log('ip-get <Logical Network UUID> <IP address>');
  console.log('ip-update <Logical Network UUID> <IP address> ' +
      'update_field=value [update_field2=value ...]');
  console.log('');
  console.log('nictag-list [filter-param=value ...]');
  console.log('nictag-get <UUID>');
  console.log('nictag-create <name> [field=value ...]');
  console.log('nictag-update <UUID> [field=value ...]');
  console.log('nictag-delete <UUID>');
  console.log('');
  console.log('ping');
  console.log('ufds-test');
  console.log('log');
  console.log('lastlog');
  console.log('tail');
}


/*
 * Exits with a message.
 */
function exit() {
  console.error.apply(null, Array.prototype.slice.apply(arguments));
  process.exit(1);
}


/*
 * Tests the UFDS connection
 */
function ufdsTest(config, callback) {
  var uuid = UUID.v4();
  var logOpts = {
    name: 'napictl',
    streams: [
      {
        path: '/var/log/napictl.log',
        level: 'debug'
      }
    ]
  };

  if (VERBOSE) {
    console.log('req_id="%s", ufds config: %s', uuid, json(config.ufds));
  }

  if (DEBUG) {
    logOpts.streams.push({
      stream: process.stderr,
      level: 'debug'
    });
  }
  var logger = bunyan.createLogger(logOpts);
  var log = logger.child({req_id: uuid});

  mod_ufds.createClient(log, config.ufds, function (err, client) {
    if (err) {
      log.error(err, 'createClient error');
      return callback(err);
    }

    return mod_nicTag.list({ ufds: client }, log, {}, function (err2, res2) {
      client.close(function (err3) {
        if (err3) {
          log.error(err3, 'client close error');
        }

        return callback(err2 ? err2 : err3, res2);
      });
    });
  });
}



// --- Nic endpoints



/*
 * Gets a nic from NAPI
 */
function getNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit('Error: must supply MAC address!');
  }

  napi.getNic(macAddr, standardHandler);
}


/*
 * Deletes a nic from NAPI
 */
function deleteNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit('Error: must supply MAC address!');
  }

  napi.deleteNic(macAddr, standardHandler);
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
    exit('Error: must supply UUID!');
  }
  napi.getNics(uuid, standardHandler);
}


/*
 * Updates a nic
 */
function updateNic(napi, opts) {
  var macAddr = opts.argv.remain[1];
  if (!macAddr) {
    exit('Error: must supply MAC address!');
  }
  var params = getKeyValParams(opts, 2);
  if (Object.keys(params).length === 0) {
    exit('Must specify parameters to update!');
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
    exit('Error: must supply logical network!');
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
    exit('Error: must supply MAC address!');
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

/*
 * Gets a network from NAPI
 */
function getNetwork(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply UUID');
  }

  napi.getNetwork(uuid, standardHandler);
}

/*
 * Creates a new network
 */
function createNetwork(napi, opts) {
  var params = getKeyValParams(opts, 1);
  napi.createNetwork(params, standardHandler);
}

/*
 * Deletes a network
 */
function deleteNetwork(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply UUID!');
  }
  var params = getKeyValParams(opts, 2);
  if (DEBUG) {
    console.log('params: %j', params);
  }
  napi.deleteNetwork(uuid, params, standardHandler);
}

/*
 * Lists the IPs for a network
 */
function listIPs(napi, opts) {
  var network = opts.argv.remain[1];
  if (!network) {
    exit('Error: must supply logical network!');
  }
  var params = getKeyValParams(opts, 2);
  napi.listIPs(network, params, standardHandler);
}


/*
 * Gets an IP in a network
 */
function getIP(napi, opts) {
  var network = opts.argv.remain[1];
  if (!network) {
    exit('Error: must supply logical network!');
  }
  var ipAddr = opts.argv.remain[2];
  if (!ipAddr) {
    exit('Error: must supply IP address!');
  }
  var params = getKeyValParams(opts, 3);
  napi.getIP(network, ipAddr, params, standardHandler);
}

/*
 * Updates an IP in a network
 */
function updateIP(napi, opts) {
  var network = opts.argv.remain[1];
  if (!network) {
    exit('Error: must supply logical network!');
  }
  var ipAddr = opts.argv.remain[2];
  if (!ipAddr) {
    exit('Error: must supply IP address!');
  }
  var params = getKeyValParams(opts, 3);
  if (Object.keys(params).length === 0) {
    exit('Must specify parameters to update!');
  }
  napi.updateIP(network, ipAddr, params, standardHandler);
}



// --- Nic Tag endpoints



/*
 * Lists all of the nic tags
 */
function listNicTags(napi, opts) {
  var params = getKeyValParams(opts, 1);
  napi.listNicTags(params, standardHandler);
}


/*
 * Creates a new nic tag
 */
function createNicTag(napi, opts) {
  var name = opts.argv.remain[1];
  if (!name) {
    exit('Error: must supply name!');
  }
  var params = getKeyValParams(opts, 2);
  napi.createNicTag(name, params, standardHandler);
}


/*
 * Gets a nic tag from NAPI
 */
function getNicTag(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply UUID!');
  }

  napi.getNicTag(uuid, standardHandler);
}


/*
 * Updates a nic tag
 */
function updateNicTag(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply UUID!');
  }
  var params = getKeyValParams(opts, 2);
  if (Object.keys(params).length === 0) {
    exit('Must specify parameters to update!');
  }
  napi.updateNicTag(uuid, params, standardHandler);
}


/*
 * Deletes a nic tag from NAPI
 */
function deleteNicTag(napi, opts) {
  var uuid = opts.argv.remain[1];
  if (!uuid) {
    exit('Error: must supply UUID!');
  }

  napi.deleteNicTag(uuid, standardHandler);
}



main();
