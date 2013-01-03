/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI unit tests
 */

var assert = require('assert-plus');
var NAPI = require('../../lib/napi').NAPI;
var napiClient = require('sdc-clients/lib/napi');
var restify = require('restify');



// --- Globals



// Set to log messages to stderr
var LOG = false;
var SERVER;
var UFDS_RETURN;



// --- Globals



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

  // XXX: replace with proper mock
  server.ufds = {
    add: function (model, cb) {
      assert.object(UFDS_RETURN.add, 'UFDS_RETURN.add');
      return cb.apply(null, UFDS_RETURN.add);
    },
    del: function (opts, cb) {
      assert.object(UFDS_RETURN.del, 'UFDS_RETURN.del');
      return cb.apply(null, UFDS_RETURN.del);
    },
    get: function (opts, cb) {
      assert.object(UFDS_RETURN.get, 'UFDS_RETURN.get');
      return cb.apply(null, UFDS_RETURN.get);
    },
    list: function (opts, cb) {
      assert.object(UFDS_RETURN.list, 'UFDS_RETURN.list');
      return cb.apply(null, UFDS_RETURN.list);
    },
    update: function (opts, cb) {
      assert.object(UFDS_RETURN.update, 'UFDS_RETURN.update');
      return cb.apply(null, UFDS_RETURN.update);
    }
  };
  UFDS_RETURN = {};

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
 * Sets mock UFDS return values
 */
function ufdsReturnValues(vals) {
  UFDS_RETURN = vals;
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



module.exports = {
  createClientAndServer: createClientAndServer,
  stopServer: stopServer,
  ufdsReturnValues: ufdsReturnValues
};
