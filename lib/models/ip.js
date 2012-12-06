/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * IP model
 */

var assert = require('assert');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_mac = require('../util/mac');



// --- Globals



var OBJ_CLASS = 'ip';
var NETWORK_DN = 'ou=networks';
var UFDS_MAP = {
  owner_uuid: 'owneruuid',
  belongs_to_uuid: 'belongstouuid',
  belongs_to_type: 'belongstotype',
  reserved: 'reserved'
};



// --- Internal helpers



/*
 * Add an IP to UFDS
 */
function addIP(app, log, params, callback) {
  log.debug(params, 'addIP: entry');
  try {
    var ip = new IP(params);
  } catch (err) {
    log.error(err, 'addIP: error creating IP');
    return callback(err);
  }

  return app.ufds.add(ip, callback);
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


/*
 * Returns the base DN for an IP based on the request params
 */
function paramsToBaseDN(params) {
  return util.format('uuid=%s, %s', params.network_uuid, NETWORK_DN);
}


/*
 * Creates an IP from the raw UFDS data
 */
function createFromRaw(params, callback) {
  var netUUID = params.dn.toString().split(',')[1].split('=')[0];
  var properParams = {
    ip: params.ip,
    network_uuid: netUUID
  };

  var paramMap = {
    owneruuid: 'owner_uuid',
    belongstouuid: 'belongs_to_uuid',
    belongstotype: 'belongs_to_type',
    reserved: 'reserved'
  };

  util_common.translateParams(params, paramMap, properParams);
  var newIP;

  try {
    newIP = new IP(properParams);
  } catch (err) {
    return callback(err);
  }

  return callback(null, newIP);
}



// --- IP object



/*
 * IP object constructor
 */
function IP(params) {
  var required = ['ip', 'network_uuid'];
  for (var r in required) {
    assert.ok(params[required[r]], required[r] + ' is required');
  }
  var ip = ipToNumber(params.ip);
  assert.ok(ip, 'invalid IP address "%s"', params.ip);
  params.ip = ip;
  this.params = params;
}


/*
 * Returns the relative dn
 */
IP.prototype.dn = function ipDN() {
  return util.format('ip=%d, uuid=%s, %s',
      this.params.ip, this.params.network_uuid, NETWORK_DN);
};


/*
 * Returns the serialized form of the IP, suitable for public consumption
 */
IP.prototype.serialize = function ipSerialize() {
  var ser =  {
    ip: util_ip.numberToAddress(this.params.ip),
    reserved: this.params.reserved ? true : false,
    free: this.params.reserved ? false : true
  };

  var optional = [ 'owner_uuid', 'belongs_to_uuid', 'belongs_to_type' ];

  for (var p in optional) {
    var param = optional[p];
    if (this.params.hasOwnProperty(param)) {
      ser[param] = this.params[param];
      ser.free = false;
    }
  }

  return ser;
};


/*
 * Returns the raw form suitable for storing in UFDS
 */
IP.prototype.raw = function ipRaw() {
  var raw = {
    ip: this.params.ip
  };
  util_common.translateParams(this.params, UFDS_MAP, raw);

  return raw;
};


/*
 * Returns the LDAP objectclass
 */
IP.prototype.objectClass = function ipObjectClass() {
  return OBJ_CLASS;
};


/*
 * Returns the integer representation of the IP
 */
IP.prototype.number = function ipNumber() {
  return this.params.ip;
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
  return app.ufds.list({
    baseDN: paramsToBaseDN(params),
    objectClass: OBJ_CLASS,
    createFunc: createFromRaw
  }, callback);
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
    return callback(new restify.InvalidArgumentError(
      'Invalid IP "%s"', params.ip));
  }

  return app.ufds.get({
    baseDN: paramsToBaseDN(params),
    objectClass: OBJ_CLASS,
    id: util.format('ip=%s', ip),
    createFunc: createFromRaw
  }, callback);
}


/*
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

  // XXX: if belongs_to_uuid is set, so should belongs_to_type
  var update = {
    baseDN: paramsToBaseDN(params),
    objectClass: OBJ_CLASS,
    id: util.format('ip=%s', ip),
    params: {},
    createFunc: createFromRaw
  };

  // If unassigning, remove the 'belongs_to' information, but keep
  // owner and reserved
  if (params.unassign) {
    for (var p in UFDS_MAP) {
      if (params.hasOwnProperty(p)) {
        update.params[UFDS_MAP[p]] = params[p];
      }
    }
    update.remove = true;
  } else {
    util_common.translateParams(params, UFDS_MAP, update.params);
  }

  return app.ufds.update(update, callback);
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

  if (params.ip) {
    return addIP(app, log, params, callback);
  }

  if (!params.network) {
    return callback(new restify.InvalidArgumentError('Must supply network!'));
  }

  // Pick a random IP number to start at, and go upward from there
  var startAt = params.network.randomIPnum();
  params.ip = startAt;
  var tries = 0;

  return util_common.repeat(function (cb) {
    addIP(app, log, params, function (err, res) {
      tries++;
      // XXX: error out if the err is not a "couldn't add to UFDS" error
      if (res) {
        return cb(null, res);
      }

      params.ip++;
      if (params.ip == params.network.params.provisionRangeEndIP + 1) {
        params.ip = params.network.provisionRangeStartIP;
      }

      if (params.ip == startAt - 1) {
        return cb(new restify.InternalError(
          'No more free IPs in logical network "%s"', params.network.name));
      }

      return cb(null, null, true);
    });
  }, function (err, res) {
    log.info({err: err, res: res}, 'createIP: start=%d, end=%d (%d tries)',
      startAt, params.ip, tries);
    return callback(err, res);
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

  return app.ufds.del({
    baseDN: paramsToBaseDN(params),
    // XXX: make this (and others) take ip as a string or a number
    id: util.format('ip=%d', params.ip)
  }, callback);
}



module.exports = {
  create: createIP,
  get: getIP,
  list: listNetworkIPs,
  update: updateIP,
  del: deleteIP
};
