/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI unit tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../lib/common');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var NAPI = require('../../lib/napi').NAPI;
var napiClient = require('sdc-clients/lib/napi');
var restify = require('restify');
var verror = require('verror');



// --- Globals



var BUCKETS = {};
// Set to log messages to stderr
var LOG = process.env.LOG || false;
var SERVER;



// --- Internal helpers



function bucketNotFoundErr(bucket) {
  var err = new verror.VError('bucket "%s" does not exist', bucket);
  err.name = 'BucketNotFoundError';
  return err;
}


function objectNotFoundErr(key) {
  var err = new verror.VError('key "%s" does not exist', key);
  err.name = 'ObjectNotFoundError';
  return err;
}



// --- Fake moray object



function FakeMoray(opts) {
  assert.object(opts, 'opts');
  assert.object(opts.log, 'opts.log');

  this.log = opts.log;
  BUCKETS = {};
}


FakeMoray.prototype._put = function _store(bucket, key, val) {
  var newVal = {};
  for (var k in val) {
    newVal[k] = val[k].toString();
  }
  BUCKETS[bucket][key] = newVal;
};


FakeMoray.prototype.batch = function batch(data, callback) {
  assert.arrayOfObject(data, 'data');

  for (var b in data) {
    var item = data[b];
    assert.string(item.bucket, 'item.bucket');
    assert.string(item.key, 'item.key');
    assert.string(item.operation, 'item.operation');
    assert.object(item.value, 'item.value');

    if (item.operation === 'put') {
      if (!BUCKETS.hasOwnProperty(item.bucket)) {
        return callback(bucketNotFoundErr(item.bucket));
      }

      this._put(item.bucket, item.key, item.value);
    }
  }

  return callback();
};


FakeMoray.prototype.createBucket =
  function createBucket(bucket, schema, callback) {

  BUCKETS[bucket] = {};
  return callback();
};


FakeMoray.prototype.delObject = function delObject(bucket, key, callback) {
  if (!BUCKETS.hasOwnProperty(bucket)) {
    return callback(bucketNotFoundErr(bucket));
  }

  if (!BUCKETS[bucket].hasOwnProperty(key)) {
    return callback(objectNotFoundErr(key));
  }

  delete BUCKETS[bucket][key];
  return callback();
};


FakeMoray.prototype.findObjects = function findObjects(bucket, filter, opts) {
  var res = new EventEmitter;
  var filterObj = ldapjs.parseFilter(filter);

  process.nextTick(function () {
    if (!BUCKETS.hasOwnProperty(bucket)) {
      res.emit('error', bucketNotFoundErr(bucket));
      return;
    }

    for (var r in BUCKETS[bucket]) {
      if (filterObj.matches(BUCKETS[bucket][r])) {
        res.emit('record', { value: BUCKETS[bucket][r] });
      }
    }

    res.emit('end');
  });

  return res;
};


FakeMoray.prototype.getBucket = function getBucket(bucket, callback) {
  if (!BUCKETS.hasOwnProperty(bucket)) {
    return callback(bucketNotFoundErr(bucket));
  }

  // The real moray returns the bucket schema here, but NAPI only
  // uses this for an existence check, so this suffices
  return callback(null, BUCKETS[bucket]);
};


FakeMoray.prototype.getObject = function getObject(bucket, key, callback) {
  if (!BUCKETS.hasOwnProperty(bucket)) {
    return callback(bucketNotFoundErr(bucket));
  }

  if (!BUCKETS[bucket].hasOwnProperty(key)) {
    return callback(objectNotFoundErr(key));
  }

  return callback(null, { value: BUCKETS[bucket][key] });
};


FakeMoray.prototype.putObject =
  function putObject(bucket, key, value, opts, callback) {
  if (typeof (opts) === 'function') {
    callback = opts;
    opts = {};
  }

  if (!BUCKETS.hasOwnProperty(bucket)) {
    return callback(bucketNotFoundErr(bucket));
  }

  this._put(bucket, key, value);
  // XXX: allow returning an error here
  return callback();
};


FakeMoray.prototype.sql = function sql(str) {
  // Mock out PG's gap detection

  /* JSSTYLED */
  var bucket = str.match(/from ([a-z0-9_]+)/)[1];
  /* JSSTYLED */
  var gt = Number(str.match(/>= (\d+)/)[1]);
  /* JSSTYLED */
  var lt = Number(str.match(/<= (\d+)/)[1]);
  var res = new EventEmitter;

  assert.string(bucket, 'bucket');
  assert.number(gt, 'gt');
  assert.number(lt, 'lt');

  process.nextTick(function () {
    if (!BUCKETS.hasOwnProperty(bucket)) {
      res.emit('error', bucketNotFoundErr(bucket));
      return;
    }

    var bucketKeys = Object.keys(BUCKETS[bucket]).map(function (k) {
      return Number(k); }).sort();
    var last = bucketKeys[0];

    for (var i in bucketKeys) {
      var ip = bucketKeys[i];
      if ((ip - last) > 1 && (last + 1) <= lt && (last + 1) >= gt) {
        res.emit('record', { gap_start: last + 1 });
        break;
      }
      last = ip;
    }

    res.emit('end');
  });

  return res;
};


FakeMoray.prototype.updateBucket =
  function updateBucket(bucket, schema, callback) {

    // XXX: throw here?
  return callback();
};


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
    config: JSON.parse(fs.readFileSync(__dirname + '/test-config.json')),
    log: log
  });

  server.initialDataLoaded = true;
  server.moray = new FakeMoray({ log: log });

  server.on('initialized', function () {
    server.start(function (err) {
      if (err) {
        return callback(err);
      }

      SERVER = server;
      return callback(null, new napiClient({
        url: server.info().url
      }));
    });
  });

  server.init();
}


/**
 * Sorts an error array by field
 */
function fieldSort(a, b) {
  return (a.field > b.field) ? 1 : -1;
}


/**
 * Returns a missing parameter error array element
 */
function missingParam(field, message) {
  assert.string(field, 'field');
  assert.optionalString(message, 'message');

  return {
    code: 'MissingParameter',
    field: field,
    message: message || 'Missing parameter'
  };
}


/**
 * Returns the moray buckets
 */
function morayBuckets() {
  return BUCKETS;
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
 * Returns the parameters for a valid IP, potentially overriding with any
 * values in override
 */
function validIPparams(override) {
  var newIP = {
    belongs_to_type: 'zone',
    belongs_to_uuid: '3c7f5393-7c69-4c7c-bc81-cb7aca031ff1',
    owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853'
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
    owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853'
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
  invalidParamErr: common.invalidParamErr,
  missingParam: missingParam,
  morayBuckets: morayBuckets,
  randomMAC: common.randomMAC,
  stopServer: stopServer,
  validIPparams: validIPparams,
  validNicparams: validNicparams,
  validNetworkParams: validNetworkParams
};
