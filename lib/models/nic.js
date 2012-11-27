/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * nic model
 */

var assert = require('assert-plus');
var constants = require('../util/constants');
var mod_ip = require('./ip');
var mod_net = require('./network');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_mac = require('../util/mac');
var vasync = require('vasync');



// --- Globals



var OBJ_CLASS = 'nic';
var BASE_DN = 'ou=nics';
var UFDS_MAP = {
  belongs_to_type: 'belongstotype',
  belongs_to_uuid: 'belongstouuid',
  nic_tag: 'nictagname',
  nic_tags_provided: 'nictagsprovided',
  owner_uuid: 'owneruuid',
  primary: 'primary'
};



// --- Internal helpers



/*
 * Creates a nic from the raw UFDS data
 */
function createFromRaw(app, log, params, callback) {
  // TODO: better handling when the data from UFDS is incomplete / invalid
  // (and other places as well)
  var properParams = {
    mac: params.mac,
    owner_uuid: params.owneruuid,
    belongs_to_uuid: params.belongstouuid,
    belongs_to_type: params.belongstotype
  };

  if (params.hasOwnProperty('primary')) {
    properParams.primary = (params.primary === 'true' ? true : false);
  }

  var optional = {
    nictagname: 'nic_tag',
    nictagsprovided: 'nic_tags_provided',
    networkuuid: 'network_uuid',
    ip: 'ip'
  };

  util_common.translateParams(params, optional, properParams);

  var newNic;
  try {
    newNic = new Nic(properParams);
  } catch (err) {
    return callback(err);
  }

  return addIPtoNic(app, log, newNic, callback);
}


/*
 * Finds a network for provisioning an IP on
 */
function findNetwork(app, log, params, callback) {
  if (params.network_uuid) {
    return mod_net.get(app, log, { uuid: params.network_uuid }, callback);
  }

  if (!params.ip) {
    return callback();
  }

  if (!params.hasOwnProperty('vlan_id') ||
    !params.hasOwnProperty('nic_tag')) {
    return callback(new restify.MissingParameterError(
      'IP specified: must also specify vlan_id and nic_tag'));
  }

  var query = {
    vlan_id: params.vlan_id,
    nic_tag: params.nic_tag
  };
  return mod_net.list(app, log, query, function (err, res) {
    if (err) {
      return callback(err);
    }

    if (res.length === 0) {
      return callback(new restify.InvalidArgumentError(
        'No networks found matching parameters: vlan_id=%d, nic_tag=%s',
        params.vlan_id, params.nic_tag));
    }
    if (res.length != 1) {
      return callback(new restify.InvalidArgumentError(
        'Too many networks found matching parameters: vlan_id=%d, nic_tag=%s',
        params.vlan_id, params.nic_tag));
    }

    return callback(null, res[0]);
  });
}

/*
 * Adds an IP and network object to a nic object (if required)
 */
function addIPtoNic(app, log, res, callback) {
  if (!res.params.ip || !res.params.network_uuid) {
    return callback(null, res);
  }

  var network, ip;

  return vasync.parallel({
    'funcs': [
      function _addIP_getNetwork(cb) {
        mod_net.get(app, log, { uuid: res.params.network_uuid },
          function (e, r) {
          if (r) {
            network = r;
          }
          return cb(e);
        });
      },
      function _addIP_getIP(cb) {
        mod_ip.get(app, log, {
          ip: res.params.ip,
          network_uuid: res.params.network_uuid
          }, function (e, r) {
            if (r) {
              ip = r;
            }
            return cb(e);
          });
      }
    ]
  }, function (err2) {
    if (err2) {
      return callback(err2);
    }

    if (!network || !ip) {
      log.error({network: network, ip: ip},
          'getNic: Missing IP or network');
      return callback(null, res);
    }

    res.ip = ip;
    res.network = network;
    return callback(null, res);
  });
}


/*
 * Finds the next free MAC address
 */
function findNextFreeMAC(nics, macOUI) {
  // Pick a random MAC number to start at, and go upward from there
  var startAt = Math.floor(Math.random() * 16777215) + 1;
  var prefix = util_mac.macOUItoNumber(macOUI);
  var num = startAt;
  var macNum;

  while (num != startAt - 1) {
    macNum = prefix + num;
    if (!nics.hasOwnProperty(macNum)) {
      return macNum;
    }
    num++;
    if (num == 16777216) {
      num = 1;
    }
  }

  return new restify.InternalError('No more free MAC addresses');
}


/*
 * Ensures request has the parameters required for all requests
 */
function validateRequiredParams(params) {
  return util_common.requireParams(['owner_uuid', 'belongs_to_uuid',
      'belongs_to_type'], params);
}



// --- Nic object



/*
 * Nic model constructor
 */
function Nic(params) {
  assert.object(params, 'params');
  assert.ok(params.mac, 'mac (number / string) is required');
  assert.string(params.owner_uuid, 'owner_uuid');
  assert.string(params.belongs_to_uuid, 'belongs_to_uuid');
  assert.string(params.belongs_to_type, 'belongs_to_type');
  assert.optionalBool(params.primary, 'primary');
  assert.optionalString(params.nic_tag, 'nic_tag');

  // Allow mac to be passed in as a number or address, but the internal
  // representation is always a number
  var mac = params.mac;
  if (isNaN(mac)) {
    mac = util_mac.macAddressToNumber(params.mac);
  }
  assert.ok(mac, util.format('invalid MAC address "%s"', params.mac));

  // Allow for UFDS returning a scalar if there's only one value, as well
  // as creating with a comma-separated list on the commandline
  if (params.hasOwnProperty('nic_tags_provided')) {
    params.nic_tags_provided = util_common.arrayify(params.nic_tags_provided)
  }
  assert.optionalArrayOfString(params.nic_tags_provided, 'nic_tags_provided');

  params.mac = mac;
  this.params = params;
}


/*
 * Returns the relative dn
 */
Nic.prototype.dn = function nicDN() {
  return util.format('mac=%d, %s', this.params.mac, BASE_DN);
};


/*
 * Returns the LDAP objectclass
 */
Nic.prototype.objectClass = function nicObjectClass() {
  return OBJ_CLASS;
};


/*
 * Returns the serialized form of the nic
 */
Nic.prototype.serialize = function nicSerialize() {
  var macAddr = util_mac.macNumberToAddress(this.params.mac);
  var serialized = {
    belongs_to_type: this.params.belongs_to_type,
    belongs_to_uuid: this.params.belongs_to_uuid,
    mac: macAddr,
    // nic: macAddr,  // XXX: for backward compatibility
    owner_uuid: this.params.owner_uuid,
    primary: this.params.primary ? true : false
  };

  if (this.ip) {
    var ipSer = this.ip.serialize();
    serialized.ip = ipSer.ip;
  }

  if (this.network) {
    var netSer = this.network.serialize();
    var netParams = ['netmask', 'gateway', 'vlan_id', 'nic_tag', 'resolvers'];
    for (var p in netParams) {
      if (netSer.hasOwnProperty(netParams[p])) {
        serialized[netParams[p]] = netSer[netParams[p]];
      }
    }
    serialized.network_uuid = netSer.uuid;
  }

  // Allow the nic to override its network's nic tag
  var optional = {
    nic_tag: 'nic_tag',
    nic_tags_provided: 'nic_tags_provided'
  };
  util_common.translateParams(this.params, optional, serialized);

  return serialized;
};


/*
 * Returns the raw form of the nic suitable for storing in UFDS
 */
Nic.prototype.raw = function nicRaw() {
  var raw = {
    mac: this.params.mac,
    owneruuid: this.params.owner_uuid,
    belongstouuid: this.params.belongs_to_uuid,
    belongstotype: this.params.belongs_to_type,
    primary: this.params.primary ? true : false
  };

  if (this.ip && this.network) {
    raw.ip = this.ip.number();
    raw.networkuuid = this.network.uuid();
  }

  var optional = {
    nic_tag: 'nictagname',
    nic_tags_provided: 'nictagsprovided'
  };
  util_common.translateParams(this.params, optional, raw);

  return raw;
};


/*
 * Gets the numeric representation of the nic's MAC address
 */
Nic.prototype.number = function nicNumber() {
  return this.mac;
};



// --- Exported functions



/*
 * Creates a new Nic (and optionally a new IP with it)
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `owner_uuid` {UUID}: Owner (required)
 * - `belongs_to_uuid` {UUID}: UUID of object this nic belongs to (required)
 * - `belongs_to_type` {String}: type of object this nic belongs to (required)
 * - `mac` {String}: MAC address to use. If not specified, one will be
 *   generated
 * - `ip` {IP}: IP address
 * - `network_uuid` {UUID}: network to create the IP on
 * - `primary` {Bool}: whether the network is primary or not
 * - `nic_tags_provided` {Array}: names of nic tags this physical nic provides
 *
 * If ip is specified in params, but not network_uuid, the following params
 * can be used to search for a network to create the IP on:
 * - `vlan` {Number}: VLAN ID
 * - `nic_tag` {String}: nic tag name
 * @param callback {Function} `function (err, nic)`
 */
function createNic(app, log, params, callback) {
  log.debug(params, 'createNic: entry');
  var paramErr = validateRequiredParams(params);
  if (paramErr != null) {
    return callback(paramErr);
  }

  var ip;
  var nic;
  var network;
  var updateIPparams = {};

  if (!params.mac) {
    // If no MAC specified, generate a random one based on the OUI in the
    // config
    // XXX: actually repeat here trying to find the next MAC
    params.mac = util_mac.randomNum(app.config.macOUI);
    log.info('createNic: no mac specified - generated "%s"', params.mac);
  }

  vasync.pipeline({
    funcs: [
      // If we want to create this nic with an IP, we need a network
      function _createGetNetwork(_, cb) {
        return findNetwork(app, log, params, function (err, res) {
          if (res) {
            network = res;
            params.network_uuid = res.params.uuid;
            params.network = res;
          }
          return cb(err);
        });
      },
      // Get the IP (if specified)
      function _getProvisionIP(_, cb) {
        if (!params.network_uuid || !params.ip) {
          return cb(null);
        }

        var ipParams = {
          network_uuid: params.network_uuid,
          ip: params.ip
        };
        return mod_ip.get(app, log, ipParams, function (err, res) {
          if (err || !res) {
            return cb(err);
          }

          if (res.hasOwnProperty('belongs_to_uuid')
            && res.belongs_to_uuid != constants.ADMIN_UUID) {
            return cb(new restify.InvalidArgumentError(
              'IP "%s" is already in use', params.ip));
          }

          var updateParams = {
            belongs_to_type: 'belongs_to_type',
            belongs_to_uuid: 'belongs_to_uuid',
            ip: 'ip',
            network_uuid: 'network_uuid',
            owner_uuid: 'owner_uuid'
          };
          util_common.translateParams(params, updateParams, updateIPparams);
          log.debug(updateIPparams, 'createNic: IP exists: updating');
          return cb();
        });
      },
      // Create the IP (if necessary, and not set to update)
      function _createProvisionIP(_, cb) {
        if (!params.network_uuid || !util_common.hashEmpty(updateIPparams)) {
          log.debug('createNic: No network: not creating an IP');
          return cb(null);
        }

        return mod_ip.create(app, log, params, function (err, res) {
          if (res) {
            ip = res;
          }
          return cb(err);
        });
      },
      // Update the IP (if wanted)
      function _updateProvisionIP(_, cb) {
        if (util_common.hashEmpty(updateIPparams)) {
          log.debug('createNic: Not updating IP');
          return cb(null);
        }

        return mod_ip.update(app, log, updateIPparams, function (err, res) {
          if (res) {
            log.debug(res, 'createNic: updated IP');
            ip = res;
          }
          return cb(err);
        });
      },
      // Now create the nic
      function _createProvisionNic(_, cb) {
        try {
          var nicObj = new Nic(params);
        } catch (err) {
          return cb(new restify.InvalidArgumentError(err.message));
        }

        if (network) {
          nicObj.network = network;
        }
        if (ip) {
          nicObj.ip = ip;
        }

        return app.ufds.add(nicObj, function (err, res) {
          if (res) {
            nic = res;
          }
          return cb(err);
        });
      }
    ]
  }, function (err, res) {
    if (err) {
      return callback(err);
    }

    return callback(null, nic);
  });

  return null;
}


/*
 * Updates a nic with the given parameters
 */
function updateNic(app, log, params, callback) {
  log.debug(params, 'updateNic: entry');

  var macNum = util_mac.macAddressToNumber(params.mac);
  if (!macNum) {
    return callback(new restify.InvalidArgumentError(
        'Invalid MAC address "%d"', params.mac));
  }

  if (params.hasOwnProperty('nic_tags_provided')) {
    params.nic_tags_provided = util_common.arrayify(params.nic_tags_provided)
  }

  var updateParams = {};
  util_common.translateParams(params, UFDS_MAP, updateParams);

  return app.ufds.update({
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    id: 'mac=' + macNum,
    params: updateParams,
    createFunc: function (p, cb) { createFromRaw(app, log, p, cb); }
  }, function _afterNicUpdate(err, res) {
    if (err) {
      return callback(err);
    }
    log.debug(updateParams, 'updateNic: nic updated');

    if (!res.params.hasOwnProperty('ip') ||
      !res.params.hasOwnProperty('network_uuid')) {
      return callback(null, res);
    }

    // Update the IP associated with this nic

    var ipParams = {
      network_uuid: res.params.network_uuid,
      ip: res.params.ip
    };
    for (var p in UFDS_MAP) {
      if (params.hasOwnProperty(p)) {
        ipParams[p] = params[p];
      }
    }

    return mod_ip.update(app, log, ipParams, function (err2, res2) {
      if (err2) {
        return callback(err);
      }
      log.debug(updateParams, 'updateNic: IP updated');

      // XXX: filter these params?
      return getNic(app, log, params, callback);
    });
  });
}


/*
 * Deletes a nic with the given parameters
 */
function deleteNic(app, log, params, callback) {
  log.debug(params, 'deleteNic: entry');

  var macNum = util_mac.macAddressToNumber(params.mac);
  if (!macNum) {
    return callback(new restify.InvalidArgumentError(
        'Invalid MAC address "%d"', params.mac));
  }

  // Need to get nic first, to see if it has an IP we need to delete
  return getNic(app, log, params, function (err, res) {
    if (err) {
      return callback(err);
    }

    return app.ufds.del({
      baseDN: BASE_DN,
      id: util.format('mac=%d', macNum)
    }, function _afterNicDel(err2) {
      log.debug('deleteNic: nic "%s": del cb entry', params.mac);
      if (err2) {
        return callback(err2);
      }

      if (!res || !res.ip) {
        log.debug('deleteNic: nic "%s" has no IP', params.mac);
        return callback();
      }

      // XXX: may want some way to override this and force the delete
      if (res.ip.params.reserved) {
        log.debug('deleteNic: nic "%s" has a reserved IP', params.mac);
        return mod_ip.update(app, log, {
          ip: res.ip.number(),
          network_uuid: res.network.params.uuid,
          belongs_to_uuid: res.ip.params.belongs_to_uuid,
          belongs_to_type: res.ip.params.belongs_to_type,
          unassign: true
        }, callback);

      } else {
        log.debug('deleteNic: nic "%s": deleting IP', params.mac);
        return mod_ip.del(app, log, {
          network_uuid: res.network.uuid(),
          ip: res.ip.number()
        }, callback);
      }
    });
  });
}


/*
 * Gets a nic
 */
function getNic(app, log, params, callback) {
  log.debug(params, 'getNic: entry');
  // XXX: validate UUID here?

  var macNum = util_mac.macAddressToNumber(params.mac);
  if (!macNum) {
    return new restify.InvalidArgumentError(
        'Invalid MAC address "%d"', params.mac);
  }

  return app.ufds.get({
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    id: 'mac=' + macNum,
    createFunc: function (p, cb) { createFromRaw(app, log, p, cb); }
  }, callback);
}


/*
 * Lists nics
 */
function listNics(app, log, params, callback) {
  log.debug(params, 'listNics: entry');
  var listParams = {
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    createFunc: function (p, cb) { createFromRaw(app, log, p, cb); }
  };

  var filter = {};
  util_common.translateParams(params, UFDS_MAP, filter);
  if (!util_common.hashEmpty(filter)) {
    listParams.filter = filter;
  }

  app.ufds.list(listParams, callback);
}


module.exports = {
  create: createNic,
  del: deleteNic,
  get: getNic,
  list: listNics,
  update: updateNic
};
