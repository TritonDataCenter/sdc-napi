/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * IP model
 */

var assert = require('assert');
var clone = require('clone');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_mac = require('../util/mac');
var validate = require('../util/validate');


// XXX: big theory statement about how we provision IPs would be nice here


// --- Globals



var BUCKET = {
  desc: 'IP',
  // name intentionally left out here: this is per-network
  schema: {
    index: {
      belongs_to_type: { type: 'string' },
      belongs_to_uuid: { type: 'string' },
      owner_uuid: { type: 'string' },
      ip: { type: 'number', unique: true },
      reserved: { type: 'boolean' }
    }
  }
};
var OPTIONAL_PARAMS = [
  'belongs_to_type',
  'belongs_to_uuid',
  'owner_uuid'
];
var PROVISION_TRIES = 10;



// --- Internal helpers



/**
 * Returns the bucket name for a network
 */
function bucketName(networkUUID) {
  return util.format('napi_ips_%s',
    networkUUID.replace(/-/g, '_'));
}


/**
 * Returns the bucket for a network
 */
function getBucketObj(networkUUID) {
  var newBucket = clone(BUCKET);
  newBucket.name = bucketName(networkUUID);
  return newBucket;
}


/*
 * Convert an IP (address or string) to integer form
 */
function ipToNumber(ip) {
  if (isNaN(ip)) {
    ip = util_ip.aton(ip);
  }
  return ip;
}


/**
 * Add an IP to moray
 */
function addIP(app, log, params, callback) {
  try {
    var ip = new IP(params);
  } catch (err) {
    log.error(err, 'addIP: error creating IP');
    return callback(err);
  }

  var ipBucket = getBucketObj(params.network_uuid);
  log.debug({ params: params, bucket: ipBucket }, 'addIP: creating IP');

  app.moray.putObject(ipBucket.name, ip.number.toString(), ip.raw(),
    function (err) {
    if (err) {
      return callback(err);
    }

    return callback(null, ip);
  });
}


/**
 * Provisions a "new" IP: creates a record in moray that doesn't exist
 * yet.
 */
function provisionNewIP(app, log, params, callback) {
  var tries = 0;
  var bucket = getBucketObj(params.network_uuid);

  return util_common.repeat(function (cb) {
    if (tries > PROVISION_TRIES) {
      return cb(null, null, false);
    }
    tries++;

    log.debug('provisionNewIP: finding gap IPs: try=%d', tries);

    var ipNum;
    var req = app.moray.sql('select * from (select ip+1 gap_start, lead(ip) ' +
      'over(order by ip) - ip - 1 gap_length from ' + bucket.name + ' ' +
      util.format('where ip >= %d AND ip <= %d) t where gap_length > 0',
        params.network.provisionMin - 1,
        params.network.provisionMax + 1));

    req.once('record', function (r) {
      log.debug(r, 'provisionNewIP: gap data');
      if (r) {
        ipNum = r.gap_start;
      }
    });

    req.once('error', function (err) {
      log.error(err, 'provisionNewIP: error');
      return cb(null, null, true);
    });

    req.once('end', function () {
      if (!ipNum) {
        // No gap found, so no sense in trying over and over
        return cb(null, null, false);
      }

      params.ip = ipNum;

      addIP(app, log, params, function (err, res) {
        // XXX: error out if the err is not a "already exists" error
        if (res) {
          return cb(null, res);
        }

        return cb(null, null, true);
      });
    });

  }, function (err, res) {
    log.info({err: err, res: res}, 'provisionNewIP: %d tries', tries);

    return callback(err, res);
  });
}


/**
 * Provisions a "freed" IP: an existing record in moray that is now free
 * for use again.
 */
function provisionFreedIP(app, log, params, callback) {
  var bucket = getBucketObj(params.network_uuid);
  var objs = [];
  // XXX: use updateObjects here?
  var req = app.moray.findObjects(bucket.name,
    util.format('(&(ip>=%d)(ip<=%d)(!(belongs_to_uuid=*))(reserved=false))',
      params.network.provisionMin,
      params.network.provisionMax),
    { sort: { attribute: 'ip', order: 'ASC' }, limit: 10 });

  req.once('error', function (err) {
    return callback(err);
  });

  req.on('record', function (obj) {
    objs.push(obj);
  });

  req.once('end', function () {
    if (!objs || objs.length === 0) {
      return callback(new restify.InternalError('no more free IPs'));
    }

    util_common.repeat(function (cb) {
      var ipRec = objs.shift();
      if (!ipRec) {
        return callback(new restify.InternalError('no more free IPs'));
      }

      params.ip = ipRec.value.ip;
      var newIP = new IP(params);
      log.debug(ipRec, 'updating ip "%s"', ipRec.key);
      app.moray.putObject(bucket.name, ipRec.key, newIP.raw(),
        { etag: ipRec._etag },
        function (err) {
        if (err) {
          return callback(null, null, true);
        }

        return callback(null, newIP);
      });
    }, callback);
  });
}



// --- IP object



/**
 * IP object constructor
 */
function IP(params) {
  this.params = params;
  this.params.ip = ipToNumber(params.ip);

  if (params.hasOwnProperty('reserved') &&
    typeof (params.reserved) !== 'boolean') {
    this.params.reserved = params.reserved === 'true' ? true : false;
  }

  this.__defineGetter__('number', function () { return this.params.ip; });
}


/**
 * Returns the serialized form of the IP, suitable for public consumption
 */
IP.prototype.serialize = function ipSerialize() {
  var self = this;
  var ser =  {
    ip: util_ip.numberToAddress(this.params.ip),
    reserved: this.params.reserved ? true : false,
    free: this.params.reserved ? false : true
  };

  OPTIONAL_PARAMS.forEach(function (param) {
    if (self.params.hasOwnProperty(param)) {
      ser[param] = self.params[param];
      ser.free = false;
    }
  });

  return ser;
};


/**
 * Returns the raw form suitable for storing in moray
 */
IP.prototype.raw = function ipRaw() {
  var self = this;
  var raw = {
    ip: this.params.ip,
    network_uuid: this.params.network_uuid,
    reserved: this.params.reserved ? true : false
  };

  OPTIONAL_PARAMS.forEach(function (param) {
    if (self.params.hasOwnProperty(param)) {
      raw[param] = self.params[param];
    }
  });

  return raw;
};



// --- Exported functions



/*
 * List IPs in a network
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ips)`
 */
function listNetworkIPs(app, log, params, callback) {
  log.debug(params, 'listNetworkIPs: entry');
  var bucket = getBucketObj(params.network_uuid);
  var networks = [];

  var listOpts = {
    sort: {
      attribute: 'ip',
      order: 'ASC'
    }
  };

  var req = app.moray.findObjects(bucket.name,
    mod_moray.filter(params, bucket) || '(ip=*)', listOpts);

  req.on('error', function _onNetListErr(err) {
    return callback(err);
  });

  req.on('record', function _onNetListRec(rec) {
    // If a record is not reserved, do not display it (the 2 keys in value in
    // this case are 'reserved' and 'ip')
    if (rec.value.reserved === 'true' || Object.keys(rec.value).length > 2) {
      networks.push(new IP(rec.value));
    }
  });

  req.on('end', function _endNetList() {
    return callback(null, networks);
  });
}


/*
 * Get an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP number (required)
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function getIP(app, log, params, callback) {
  log.debug(params, 'getIP: entry');
  var ip = ipToNumber(params.ip);
  if (!ip) {
    return callback(new restify.InvalidArgumentError('invalid IP'));
  }

  var ipBucket = getBucketObj(params.network_uuid);
  mod_moray.getObj(app.moray, ipBucket, ip.toString(), function (err, rec) {
    if (err) {
      // XXX: this is awful. It would be nice if the moray client gave back a
      // more specific error.
      if (err.message.indexOf('does not exist') !== -1) {
        return callback(new restify.ResourceNotFoundError('IP not found'));
      }

      return callback(err);
    }

    return callback(null, new IP(rec.value));
  });
}


/**
 * Updates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `belongs_to_type`: Belongs to type (optional)
 * - `belongs_to_uuid`: Belongs to UUID (optional)
 * - `ip`: IP address or number (required)
 * - `network_uuid`: Network UUID (required)
 * - `owner_uuid`: Owner UUID (optional)
 * - `reserved`: Reserved (optional)
 * @param callback {Function} `function (err, ipObj)`
 */
function updateIP(app, log, params, callback) {
  log.debug(params, 'updateIP: entry');
  var ip = ipToNumber(params.ip);

  if (!ip) {
    return callback(new restify.InvalidArgumentError(
      'Invalid IP "%s"', params.ip));
  }

  var validateParams = {
    params: params,
    optional: {
      belongs_to_type: validate.string,
      belongs_to_uuid: validate.UUID,
      owner_uuid: validate.UUID,
      reserved: validate.bool
    },
    required: {}
  };

  // both belongs_to_type and belongs_to_uuid must be set in UFDS at the
  // same time.  If they are set, owner_uuid must be as well.
  if (params.hasOwnProperty('oldIP')) {
    if (params.belongs_to_uuid && !params.oldIP.belongs_to_type) {
      validateParams.required.belongs_to_type =
        validateParams.optional.belongs_to_type;
      delete validateParams.optional.belongs_to_type;
    }

    if (params.belongs_to_type && !params.oldIP.belongs_to_uuid) {
      validateParams.required.belongs_to_uuid =
        validateParams.optional.belongs_to_uuid;
      delete validateParams.optional.belongs_to_uuid;
    }

    if (!params.oldIP.owner_uuid && (params.belongs_to_type ||
      params.belongs_to_uuid)) {
      validateParams.required.owner_uuid =
        validateParams.optional.owner_uuid;
      delete validateParams.optional.owner_uuid;
    }
  }

  validate.params(validateParams, function (validationErr, validatedParams) {
    if (validationErr) {
      return callback(validationErr);
    }

    var updateOpts = {
      bucket: getBucketObj(params.network_uuid),
      key: ip.toString(),
      moray: app.moray,
      val: validatedParams
    };

    // If unassigning, remove the 'belongs_to' information, but keep
    // owner and reserved
    if (params.unassign) {
      updateOpts.val = {
        belongs_to_type: true,
        belongs_to_uuid: true
      };
      updateOpts.remove = true;
    }

    mod_moray.updateObj(updateOpts, function (err, rec) {
      if (err) {
        return callback(err);
      }

      return callback(null, new IP(rec.value));
    });
  });
}


/**
 * Creates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP address or number (required)
 * - `network_uuid`: Network UUID (required)
 * - `network`: Network object (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function createIP(app, log, params, callback) {
  log.debug(params, 'createIP: entry');

  // We don't validate the IP address here: the assumption is whatever is
  // calling us has already done this for other reasons (network validation,
  // subnet bounds checking).
  var validateParams = {
    params: params,
    required: {},
    optional: {
      reserved: validate.bool
    }
  };

  if (params.hasOwnProperty('belongs_to_uuid') ||
    params.hasOwnProperty('belongs_to_type')) {
    validateParams.required.belongs_to_uuid = validate.UUID;
    validateParams.required.belongs_to_type = validate.string;
    validateParams.required.owner_uuid = validate.UUID;
  }

  validate.params(validateParams, function (validationErr) {
    if (validationErr) {
      return callback(validationErr);
    }

    if (params.ip) {
      // IP address specified: try to add it to UFDS
      return addIP(app, log, params, callback);
    }

    if (!params.network) {
      return callback(new restify.InvalidArgumentError('Must supply network!'));
    }

    // No IP specified: try to find the next available IP
    provisionNewIP(app, log, params, function (err, res) {
      if (err) {
        return callback(err);
      }

      if (res) {
        return callback(null, res);
      }

      provisionFreedIP(app, log, params, function (err2, res2) {
        if (err2) {
          return callback(err2);
        }

        if (!res2) {
          return new restify.InternalError('no more free IPs');
        }

        return callback(null, res2);
      });
    });
  });
}


/**
 * Creates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `batch` {Array of Objects}
 * - `ip`: IP address or number (required)
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function batchCreateIPs(app, log, params, callback) {
  log.debug(params, 'batchCreateIPs: entry');
  var bucket = getBucketObj(params.network_uuid);
  var ips = [];

  var batchData = params.batch.map(function (ipParams) {
    var ip = new IP(ipParams);
    ips.push(ip);
    return {
      bucket : bucket.name,
      key: ip.number.toString(),
      operation: 'put',
      value: ip.raw()
    };
  });

  log.info(batchData, 'batchCreateIPs: creating IPs');
  app.moray.batch(batchData, function (err) {
    if (err) {
      return callback(err);
    }

    return callback(null, ips);
  });
}


/*
 * Deletes an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP number or address (required)
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function deleteIP(app, log, params, callback) {
  log.debug(params, 'deleteIP: entry');
  var ip = ipToNumber(params.ip);
  if (!ip) {
    return callback(new restify.InvalidArgumentError(
      'Invalid IP "%s"', params.ip));
  }

  mod_moray.updateObj({
    bucket: getBucketObj(params.network_uuid),
    key: ip.toString(),
    moray: app.moray,
    replace: true,
    val: { ip: ip.toString() }
  }, callback);
}


/**
 * Initializes the nic tags bucket
 */
function initIPbucket(app, networkUUID, callback) {
  var ipBucket = getBucketObj(networkUUID);
  mod_moray.initBucket(app.moray, ipBucket, callback);
}



module.exports = {
  batchCreate: batchCreateIPs,
  bucket: getBucketObj,
  bucketInit: initIPbucket,
  create: createIP,
  get: getIP,
  IP: IP,
  list: listNetworkIPs,
  update: updateIP,
  del: deleteIP
};
