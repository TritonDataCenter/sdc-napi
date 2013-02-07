/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * network pool model
 */

var assert = require('assert');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');



// --- Globals



var BUCKET = {
  desc: 'network pool',
  name: 'napi_network_pools',
  schema: {
    index: {
      uuid: { type: 'string', unique: true }
    }
  }
};
var MAX_NETS = 64;



// --- Helpers


function validateNetworks(app, log, name, list, callback) {
  var errs = [];
  var uuids = util_common.arrayify(list);
  var validated = [];

  if (uuids.length > MAX_NETS) {
    return callback(errors.invalidParam(name,
      util.format('maximum %d networks per network pool', MAX_NETS)));
  }

  vasync.forEachParallel({
    inputs: uuids,
    func: function _validateNetworkUUID(uuid, cb) {
      // XXX: what to bubble up if this is an error talking to moray?
      mod_net.get(app, log, { uuid: uuid }, function (err, res) {
        if (err || !res) {
          errs.push(uuid);
          return cb();
        }

        validated.push(uuid);
        return cb();
      });
    }
  }, function () {
    if (errs.length !== 0) {
      var err = errors.invalidParam(name,
        util.format('unknown network%s', errs.length === 1 ? '' : 's'));
      err.invalid = errs;
      return callback(err);
    }

    return callback(null, validated);
  });
}



// --- NetworkPool object



/**
 * Network pool model constructor
 */
function NetworkPool(params) {
  this.params = params;
  if (!this.params.uuid) {
    this.params.uuid = UUID.v4();
  }

  if (this.params.hasOwnProperty('networks')) {
    this.params.networks = util_common.arrayify(this.params.networks);
  }

  this.__defineGetter__('networks', function () {
    return this.params.networks.sort();
  });
  this.__defineGetter__('uuid', function () { return this.params.uuid; });
}


/**
 * Returns the serialized form of the network pool, which also happens to
 * be the raw moray form of the network pool
 */
NetworkPool.prototype.raw = NetworkPool.prototype.serialize =
  function poolSerialize() {
  return {
    uuid: this.params.uuid,
    name: this.params.name,
    networks: this.params.networks.sort()
  };
};



// --- Exported functions



/**
 * Creates a new network pool
 */
function createNetworkPool(app, log, params, callback) {
  log.debug(params, 'createNetworkPool: entry');

  validate.params({
    params: params,
    required: {
      name: validate.string,
      networks: function (name, list, cb) {
        return validateNetworks(app, log, name, list, cb);
      }
    },
    optional: {
      uuid: validate.UUID
    }
  }, function (err, validatedParams) {
    if (err) {
      return callback(err);
    }

    var pool = new NetworkPool(validatedParams);
    app.moray.putObject(BUCKET.name, pool.uuid, pool.raw(),
      function (err2) {
      if (err2) {
        return callback(err2);
      }

      return callback(null, pool);
    });
  });
}


/**
 * Gets a network pool
 */
function getNetworkPool(app, log, params, callback) {
  log.debug(params, 'getNetworkPool: entry');

  validate.params({
    params: params,
    required: {
      uuid: validate.UUID
    }
  }, function (err) {
    if (err) {
      return callback(err);
    }

    mod_moray.getObj(app.moray, BUCKET, params.uuid,
      function (err2, rec) {
      if (err2) {
        return callback(err2);
      }

      return callback(null, new NetworkPool(rec.value));
    });
  });
}


/**
 * Lists network pools
 */
function listNetworkPools(app, log, params, callback) {
  log.debug(params, 'listNetworkPools: entry');
  var req = app.moray.findObjects(BUCKET.name, '(uuid=*)', {
    sort: {
      attribute: 'uuid',
      order: 'ASC'
    }
  });

  var pools = [];

  req.on('error', function _onListErr(err) {
    return callback(err);
  });

  req.on('record', function _onListRec(rec) {
    log.debug(rec, 'record from moray');
    pools.push(new NetworkPool(rec.value));
  });

  req.on('end', function _endList() {
    return callback(null, pools);
  });
}


/**
 * Updates a network pool
 */
function updateNetworkPool(app, log, params, callback) {
  log.debug(params, 'updateNetworkPool: entry');

  validate.params({
    params: params,
    required: {
      uuid: validate.UUID
    },
    optional: {
      name: validate.string,
      networks: function (name, list, cb) {
        return validateNetworks(app, log, name, list, cb);
      }
    }
  }, function (err, validatedParams) {
    if (err) {
      return callback(err);
    }

    mod_moray.updateObj({
      moray: app.moray,
      bucket: BUCKET,
      key: params.uuid,
      val: validatedParams
    }, function (err2, rec) {
      if (err2) {
        return callback(err2);
      }

      return callback(null, new NetworkPool(rec.value));
    });
  });
}


/**
 * Deletes a network pool
 */
function deleteNetworkPool(app, log, params, callback) {
  log.debug(params, 'deleteNetworkPool: entry');

  validate.params({
    params: params,
    required: {
      uuid: validate.UUID
    }
  }, function (err) {
    if (err) {
      return callback(err);
    }

    app.moray.delObject(BUCKET.name, params.uuid, function (err2) {
      if (err2) {
        return callback(err2);
      }

      return callback();
    });
  });
}


/**
 * Initializes the network pools bucket
 */
function initNetworkPools(app, callback) {
  mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
  create: createNetworkPool,
  del: deleteNetworkPool,
  get: getNetworkPool,
  init: initNetworkPools,
  list: listNetworkPools,
  NetworkPool: NetworkPool,
  update: updateNetworkPool
};
