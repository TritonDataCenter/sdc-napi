/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI unit tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var NAPI = require('../../lib/napi').NAPI;
var napiClient = require('sdc-clients/lib/napi');
var restify = require('restify');



// --- Globals



// Set to log messages to stderr
var LOG = false;
var SERVER;
var UFDS_RETURN;
var SENT_TO_UFDS;



// --- Internal helpers



function ufdsEntry(action, obj) {
  assert.arrayOfObject(UFDS_RETURN[action], 'UFDS_RETURN.' + action);
  assert.ok(UFDS_RETURN[action].length !== 0,
    'UFDS_RETURN.' + action + ': no more elements');

  if (!SENT_TO_UFDS) {
    SENT_TO_UFDS = {};
  }

  if (!SENT_TO_UFDS[action]) {
    SENT_TO_UFDS[action] = [];
  }

  SENT_TO_UFDS[action].push(obj);
}



// --- Exports



/**
 * Creates a test NAPI server, and returns a client for accessing it
 */
function createClientAndServer(callback) {
  var log;
  if (LOG) {
    log = require('bunyan').createLogger({
      level: (process.env.LOG_LEVEL || 'warn'),
      name: process.argv[1],
      stream: process.stderr,
      serializers: restify.bunyan.serializers,
      src: true
    });

  } else {
    log = {
      child: function () { return log; },
      debug: function () { return false; },
      error: function () { return false; },
      info: function () { return false; },
      trace: function () { return false; },
      warn: function () { return false; }
    };
  }

  var server = new NAPI({
    config: {
      port: 0
    },
    log: log
  });

  server.initialDataLoaded = true;
  server.ufds = {
    add: function (model, cb) {
      ufdsEntry('add', model);
      var next = UFDS_RETURN.add.shift();
      if (next[0]) {
        return cb(next[0]);
      }
      return cb(null, model);
    },
    del: function (opts, cb) {
      ufdsEntry('del', opts);
      return cb(UFDS_RETURN.del.shift());
    },
    get: function (opts, cb) {
      ufdsEntry('get', opts);
      return cb.apply(null, UFDS_RETURN.get.shift());
    },
    list: function (opts, cb) {
      ufdsEntry('list', opts);
      return cb.apply(null, UFDS_RETURN.list.shift());
    },
    update: function (opts, cb) {
      ufdsEntry('update', opts);
      return cb.apply(null, UFDS_RETURN.update.shift());
    }
  };

  UFDS_RETURN = {};
  SENT_TO_UFDS = null;

  server.start(function (err) {
    if (err) {
      return callback(err);
    }

    SERVER = server;
    return callback(null, new napiClient({
      url: server.info().url
    }));
  });
}


/**
 * Sorts an error array by field
 */
function fieldSort(a, b) {
  return (a.field > b.field);
}


/**
 * Returns an invalid parameter error array element
 */
function invalidParam(field, message) {
  assert.string(field);
  assert.string(message);

  return {
    code: 'InvalidParameter',
    field: field,
    message: message
  };
}


/**
 * Returns a missing parameter error array element
 */
function missingParam(field, message) {
  assert.string(field);

  return {
    code: 'MissingParameter',
    field: field,
    message: 'Missing parameter'
  };
}


/**
 * Stops the test NAPI server
 */
function stopServer(callback) {
  if (!SERVER) {
    return callback();
  }

  return SERVER.stop(callback);
}


/**
 * Sets mock UFDS return values
 */
function ufdsReturnValues(vals) {
  if (!vals) {
    return UFDS_RETURN;
  }

  UFDS_RETURN = clone(vals);
  SENT_TO_UFDS = null;
}


/**
 * Gets values that UFDS mock was called with
 */
function ufdsCallValues(vals) {
  return clone(SENT_TO_UFDS);
}


/**
 * Returns the parameters for a valid IP, potentially overriding with any
 * values in override
 */
function validIPparams(override) {
  var newIP = {
    belongs_to_type: 'zone',
    belongs_to_uuid: '3c7f5393-7c69-4c7c-bc81-cb7aca031ff1',
    owner_uuid: '00000000-0000-0000-0000-000000000000'
  };

  for (var o in override) {
    newIP[o] = override[o];
  }

  return newIP;
}


/**
 * Returns the parameters for a valid IP, potentially overriding with any
 * values in override
 */
function validNicparams(override) {
  var newNic = {
    belongs_to_type: 'zone',
    belongs_to_uuid: '3c7f5393-7c69-4c7c-bc81-cb7aca031ff1',
    owner_uuid: '00000000-0000-0000-0000-000000000000'
  };

  for (var o in override) {
    newNic[o] = override[o];
  }

  return newNic;
}


/**
 * Returns the parameters for a valid network, potentially overriding with any
 * values in override
 */
function validNetworkParams(override) {
  var newNet = {
    name: 'myname',
    nic_tag: 'nic_tag',
    provision_end_ip: '10.0.2.254',
    provision_start_ip: '10.0.2.1',
    resolvers: ['8.8.8.8', '8.8.4.4'],
    subnet: '10.0.2.0/24',
    vlan_id: '0'
  };

  for (var o in override) {
    newNet[o] = override[o];
  }

  return newNet;
}



module.exports = {
  createClientAndServer: createClientAndServer,
  fieldSort: fieldSort,
  invalidParam: invalidParam,
  missingParam: missingParam,
  stopServer: stopServer,
  ufdsCallValues: ufdsCallValues,
  ufdsReturnValues: ufdsReturnValues,
  validIPparams: validIPparams,
  validNicparams: validNicparams,
  validNetworkParams: validNetworkParams
};
