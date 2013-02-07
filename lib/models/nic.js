/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * nic model
 */

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
var mod_nicTag = require('./nic-tag');
var mod_pool = require('./network-pool');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_mac = require('../util/mac');
var validate = require('../util/validate');
var vasync = require('vasync');
var verror = require('verror');



// --- Globals



var BUCKET = {
  desc: 'nic',
  name: 'napi_nics',
  schema: {
    index: {
      belongs_to_type: { type: 'string' },
      belongs_to_uuid: { type: 'string' },
      ip: { type: 'number' },
      mac: { type: 'number', unique: true },
      nic_tag: { type: 'string' },
      nic_tags_provided: { type: 'string' },
      owner_uuid: { type: 'string' }
    }
  }
};
var IP_PARAMS = [
  'belongs_to_type',
  'belongs_to_uuid',
  'owner_uuid',
  'reserved'
];
var OPTIONAL_PARAMS = [
  'model',
  'nic_tag',
  'nic_tags_provided'
];



// --- Internal helpers



/**
 * Ensure the nic tags exist
 */
function ensureNicTagsExist(app, log, name, tags, callback) {
  var errTags = [];
  var tagArr = util_common.arrayify(tags);

  if (tagArr.length === 0) {
    return callback(null, tagArr);
  }

  vasync.forEachParallel({
    inputs: tagArr,
    func: function _getNicTag(tag, cb) {
      return mod_nicTag.get(app, log, { name: tag }, function (err, res) {
        if (err || !res) {
          errTags.push(tag);
        }

        return cb();
      });
    }
  }, function () {
    if (errTags.length !== 0) {
      var err = errors.invalidParam(name,
        util.format('nic tag%s not exist', errTags.length === 1 ?
          ' does' : 's do'));
      err.invalid = errTags;
      return callback(err);
    }

    return callback(null, tagArr);
  });
}


/**
 * Validate that the network parameters are valid
 */
function validateNetworkParams(app, log, params, parsedParams, callback) {
  // Not allowed to provision an IP on a network pool
  if (parsedParams.ip && parsedParams.network_pool) {
    return callback(errors.invalidParam('ip', constants.POOL_IP_MSG));
  }

  if (params.hasOwnProperty('network_uuid') &&
      !parsedParams.hasOwnProperty('network')) {
    // network validation has failed - we've already returned an invalid
    // parameter error
    return callback();
  }

  // network_uuid and ip were specified, so just validate
  if (parsedParams.ip && parsedParams.network) {
    return validateSubnetContainsIP(parsedParams, callback);
  }

  if (!parsedParams.ip) {
    return callback();
  }

  // ip specified, but not network_uuid: vlan_id and nic_tag are needed to
  // figure out what network the nic is on
  var errs = [];
  ['nic_tag', 'vlan_id'].forEach(function (p) {
    if (!parsedParams.hasOwnProperty('vlan_id')) {
      errs.push(errors.missingParam(p,
        'required if IP specified but not network_uuid'));
    }
  });

  if (errs.length !== 0) {
    return callback(errs);
  }

  var query = {
    vlan_id: parsedParams.vlan_id,
    nic_tag: parsedParams.nic_tag
  };

  return mod_net.list(app, log, query, function (err, res) {
    if (err) {
      return callback(err);
    }

    if (res.length === 0) {
      return callback(['nic_tag', 'vlan_id'].map(function (p) {
        return errors.invalidParam(p,
        'No networks found matching parameters');
      }));
    }

    if (res.length != 1) {
      return callback(['nic_tag', 'vlan_id'].map(function (p) {
        return errors.invalidParam(p,
        'Too many networks found matching parameters');
      }));
    }

    parsedParams.network = res[0];
    parsedParams.network_uuid = res[0].uuid;

    return validateSubnetContainsIP(parsedParams, callback);
  });
}


/**
 * Validate that the subnet contains the IP address
 */
function validateSubnetContainsIP(parsedParams, callback) {
  if (parsedParams.ip < parsedParams.network.minIP ||
      parsedParams.ip > parsedParams.network.maxIP) {
    return callback(errors.invalidParam('ip',
      'ip cannot be outside subnet'));
  }

  return callback();
}


/**
 * Validates a MAC address
 */
function validateMAC(name, mac, callback) {
  var macNum = util_mac.macAddressToNumber(mac);
  if (!macNum) {
    return callback(errors.invalidParam(name,
      'invalid IP address'));
  }

  return callback(null, macNum);
}


/**
 * Validates a network UUID
 */
function validateNetworkUUID(name, uuid, callback) {
  if (uuid === 'admin') {
    return callback(null, uuid);
  }

  return validate.UUID(name, uuid, callback);
}


/**
 * Validates a network UUID and ensures that the network exists
 */
function validateNetworkPool(app, log, name, uuid, callback) {
  mod_pool.get(app, log, { uuid: uuid }, function (err2, res) {
    if (err2) {
      if (err2.name === 'ResourceNotFoundError') {
        return callback(errors.invalidParam(name,
          'network does not exist'));
      }

      return callback(err2);
    }

    var toReturn = {
      network_pool: res
    };
    toReturn[name] = res.uuid;
    return callback(null, toReturn);
  });
}


/**
 * Validates a network UUID and ensures that the network exists
 */
function validateNetwork(app, log, name, uuid, callback) {
  validateNetworkUUID(name, uuid, function (err) {
    if (err) {
      return callback(err);
    }

    mod_net.get(app, log, { uuid: uuid }, function (err2, res) {
      if (err2) {
        if (err2.name === 'ResourceNotFoundError') {
          return validateNetworkPool(app, log, name, uuid, callback);
        }

        return callback(err2);
      }

      var toReturn = {
        network: res
      };
      toReturn[name] = res.uuid;
      return callback(null, toReturn);
    });
  });
}


/**
 * Creates a nic from the raw moray data
 */
function createFromRaw(app, log, params, callback) {
  log.debug(params, 'createFromRaw: creating nic');
  var newNic;
  try {
    newNic = new Nic(params);
  } catch (err) {
    return callback(err);
  }

  return addIPtoNic(app, log, newNic, callback);
}


/**
 * Provision an IP on a network
 */
function provisionIPonNetwork(app, log, params, callback) {
  var ipParams = {
    network: params.network,
    network_uuid: params.network.uuid
  };

  IP_PARAMS.forEach(function (p) {
    if (params.hasOwnProperty(p)) {
      ipParams[p] = params[p];
    }
  });

  return mod_ip.create(app, log, ipParams, callback);
}


/**
 * Provision an IP on a network
 */
function provisionIPonNetworkPool(app, log, params, callback) {
  var uuids = clone(params.network_pool.networks);

  function tryNetProvision() {
    var nextUUID = uuids.shift();
    if (!nextUUID) {
      return callback(new errors.InvalidParamsError('Invalid parameters',
        [ errors.invalidParam('network_uuid', constants.POOL_FULL_MSG) ]));
    }

    log.debug('network pool %s: trying network %s', params.network_pool.uuid,
      nextUUID);

    mod_net.get(app, log, { uuid: nextUUID }, function (err, res) {
      if (err) {
        log.error(err, 'provisionIPonNetworkPool: error getting network %s',
          nextUUID);
        return process.nextTick(tryNetProvision);
      }

      params.network = res;
      params.network_uuid = res.uuid;
      return provisionIPonNetwork(app, log, params, function (err2, res2) {
        if (err2) {
          log.error(err2,
            'provisionIPonNetworkPool: error provisioning on network %s',
            nextUUID);
          return process.nextTick(tryNetProvision);
        }

        return callback(null, res2);
      });
    });
  }

  tryNetProvision();
}


/**
 * Provision an IP
 */
function provisionSpecificIP(app, log, params, callback) {
  var ipParams = {
    network: params.network,
    network_uuid: params.network.uuid,
    ip: params.ip
  };

  IP_PARAMS.forEach(function (p) {
    if (params.hasOwnProperty(p)) {
      ipParams[p] = params[p];
    }
  });

  mod_ip.get(app, log, ipParams, function (err, res) {
    if (err) {
      if (err.name === 'ResourceNotFoundError') {
        // Does not exist, so do a create
        return mod_ip.create(app, log, ipParams, callback);
      }

      return callback(err);
    }

    if (res.hasOwnProperty('belongs_to_uuid') &&
      res.belongs_to_uuid != constants.ADMIN_UUID) {
      return callback(new errors.InvalidParamsError(
        'Invalid parameters', [ errors.usedByParam('ip', res.belongs_to_type,
          res.belongs_to_uuid) ]));
    }

    return mod_ip.update(app, log, ipParams, callback);
  });
}


/**
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
      log.error(err2, 'addIPtoNic: Missing IP or network');
      return callback(null, res);
    }

    if (!network || !ip) {
      log.error({network: network, ip: ip},
          'addIPtoNic: Missing IP or network');
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



// --- Nic object



/**
 * Nic model constructor
 */
function Nic(params) {
  assert.object(params, 'params');
  assert.ok(params.mac, 'mac (number / string) is required');
  assert.string(params.owner_uuid, 'owner_uuid');
  assert.string(params.belongs_to_uuid, 'belongs_to_uuid');
  assert.string(params.belongs_to_type, 'belongs_to_type');
  assert.optionalString(params.model, 'model');
  assert.optionalString(params.nic_tag, 'nic_tag');

  // Allow mac to be passed in as a number or address, but the internal
  // representation is always a number
  var mac = params.mac;
  if (isNaN(mac)) {
    mac = util_mac.macAddressToNumber(params.mac);
  }
  assert.ok(mac, util.format('invalid MAC address "%s"', params.mac));

  // Allow for a comma-separated list, like on the commandline
  if (params.hasOwnProperty('nic_tags_provided')) {
    params.nic_tags_provided = util_common.arrayify(params.nic_tags_provided);
  }
  assert.optionalArrayOfString(params.nic_tags_provided, 'nic_tags_provided');

  params.mac = mac;
  this.params = params;

  if (params.hasOwnProperty('primary') &&
    typeof (params.primary) !== 'boolean') {
    this.params.primary = params.primary === 'true' ? true : false;
  }

  this.__defineGetter__('mac', function () { return this.params.mac; });
}


/**
 * Returns the serialized form of the nic
 */
Nic.prototype.serialize = function nicSerialize() {
  var self = this;
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
  OPTIONAL_PARAMS.forEach(function (param) {
    if (self.params.hasOwnProperty(param)) {
      serialized[param] = self.params[param];
    }
  });

  return serialized;
};


/**
 * Returns the raw form of the nic suitable for storing in moray
 */
Nic.prototype.raw = function nicRaw() {
  var self = this;
  var raw = {
    mac: this.params.mac,
    owner_uuid: this.params.owner_uuid,
    belongs_to_uuid: this.params.belongs_to_uuid,
    belongs_to_type: this.params.belongs_to_type,
    primary: this.params.primary ? true : false
  };

  if (this.ip && this.network) {
    raw.ip = this.ip.number;
    raw.network_uuid = this.network.uuid;
  }

  OPTIONAL_PARAMS.forEach(function (param) {
    if (self.params.hasOwnProperty(param)) {
      raw[param] = self.params[param];
      raw.free = false;
    }
  });

  return raw;
};



// --- Exported functions



/**
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
  var ip;
  var nic;
  var validated;

  vasync.pipeline({
    funcs: [
      function _validateParams(_, cb) {
        delete params.network;

        var toValidate = {
          params: params,

          required: {
            belongs_to_uuid: validate.UUID,
            belongs_to_type: validate.string,
            owner_uuid: validate.UUID
          },

          optional: {
            ip: validate.IP,
            mac: validate.MAC,
            model: validate.string,
            network_uuid: validateNetwork.bind(null, app, log),
            nic_tag: mod_nicTag.validateExists.bind(null, app, log),
            nic_tags_provided: ensureNicTagsExist.bind(null, app, log),
            // XXX: only allow one of the nics for a belongs_to to be primary
            primary: validate.bool,
            reserved: validate.bool,
            vlan_id: validate.VLAN
          },

          after: validateNetworkParams.bind(null, app, log)
        };

        validate.params(toValidate, function (err, res) {
          if (err) {
            return cb(err);
          }

          validated = res;

          if (!validated.mac) {
            // If no MAC specified, generate a random one based on the OUI in
            // the config
            // XXX: actually repeat here trying to find the next MAC
            validated.mac = util_mac.randomNum(app.config.macOUI);
            log.info('createNic: no mac specified - generated "%s"',
              validated.mac);
          }

          return cb();
        });
      },

      // Create or provision the IP
      function _ip(_, cb) {
        var provFn;

        if (validated.network_pool) {
          provFn = provisionIPonNetworkPool;
        } else if (validated.network) {
          provFn = validated.ip ? provisionSpecificIP : provisionIPonNetwork;
        }

        if (!provFn) {
          return cb(null);
        }

        return provFn(app, log, validated, function (err, res) {
          if (res) {
            ip = res;
          }

          return cb(err);
        });
      },

      // Now create the nic
      function _createProvisionNic(_, cb) {
        try {
          nic = new Nic(validated);
        } catch (err) {
          return cb(new restify.InvalidArgumentError(err.message));
        }

        if (validated.network) {
          nic.network = validated.network;
        }

        if (ip) {
          nic.ip = ip;
        }

        app.moray.putObject(BUCKET.name, nic.mac.toString(), nic.raw(),
          { etag: null }, function (err) {
          if (err && err.name === 'EtagConflictError') {
            return cb(new errors.InvalidParamsError('Invalid parameters',
              [ errors.duplicateParam('mac') ]));
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
}


/**
 * Updates a nic with the given parameters
 */
function updateNic(app, log, params, callback) {
  log.debug(params, 'updateNic: entry');

  var ip;
  var oldNic;
  var updatedNic;
  var updateParams;

  vasync.pipeline({
    funcs: [
      function _getOldNic(_, cb) {
        getNic(app, log, params, function (err, res) {
          if (err) {
            return cb(err);
          }

          oldNic = res;
          return cb();
        });
      },

      function _validate(_, cb) {
        validate.params({
          params: params,

          required: {
            mac: validateMAC
          },

          optional: {
            belongs_to_type: validate.string,
            belongs_to_uuid: validate.UUID,
            ip: validate.IP,
            owner_uuid: validate.UUID,
            model: validate.string,
            network_uuid: validateNetwork.bind(null, app, log),
            nic_tag: mod_nicTag.validateExists.bind(null, app, log),
            nic_tags_provided: ensureNicTagsExist.bind(null, app, log),
            primary: validate.bool,
            reserved: validate.bool,
            vlan_id: validate.VLAN
          },

          after: function (original, parsed, cb2) {
            // Updating to a new IP (but not changing the network): validate
            // against the old IP's subnet
            if (parsed.hasOwnProperty('ip') &&
              !parsed.hasOwnProperty('network') && oldNic &&
              oldNic.hasOwnProperty('network')) {
              parsed.network = oldNic.network;
              parsed.network_uuid = oldNic.network.uuid;
            }

            validateNetworkParams(app, log, original, parsed, cb2);
          }
        }, function (err, res) {
          updateParams = res;
          return cb(err);
        });
      },

      // If network_uuid was specified in the request, provision an IP on that
      // network
      function _provisionIP(_, cb) {
        if (!updateParams.network) {
          return cb();
        }

        var ipParams = {
          network: updateParams.network,
          network_uuid: updateParams.network_uuid
        };

        IP_PARAMS.forEach(function (p) {
          if (oldNic && oldNic.params.hasOwnProperty(p)) {
            ipParams[p] = oldNic.params[p];
          }
          if (updateParams.hasOwnProperty(p)) {
            ipParams[p] = updateParams[p];
          }
        });

        return provisionIPonNetwork(app, log, ipParams,
          function (err, res) {
          if (res) {
            ip = res;
            updateParams.ip = ip.number;
          }

          return cb(err);
        });
      },

      function _updateNic(_, cb) {
        log.debug(updateParams, 'Updating nic "%s"', params.mac);

        var updateOpts = {
          bucket: BUCKET,
          key: updateParams.mac.toString(),
          moray: app.moray,
          val: updateParams
        };

        mod_moray.updateObj(updateOpts, function (err, rec) {
          if (err) {
            return cb(err);
          }

          try {
            updatedNic = new Nic(rec.value);
          } catch (err2) {
            return cb(err2);
          }

          return cb();
        });
      },

      // Update the IP associated with the nic (unless we provisioned an IP
      // above)
      function _updateIP(_, cb) {
        if (ip) {
          // We created the IP already - no need to update
          return cb();
        }

        if (!oldNic || !oldNic.hasOwnProperty('ip') ||
          !oldNic.hasOwnProperty('network')) {
          if (oldNic) {
            log.debug(oldNic.serialize(),
              'nic "%s" before update missing ip or network: not updating IP',
              params.mac);
          } else {
            log.debug('No previous nic for "%s": not updating IP', params.mac);
          }

          return cb();
        }

        var ipParams = {
          network_uuid: oldNic.params.network_uuid,
          ip: oldNic.params.ip
        };

        IP_PARAMS.forEach(function (p) {
          if (updateParams.hasOwnProperty(p)) {
            ipParams[p] = updateParams[p];
          }
        });

        log.debug(ipParams, 'Updating IP %s for nic "%s"',
          params.ip, params.mac);

        return mod_ip.update(app, log, ipParams, function (err, res) {
          if (err) {
            return cb(err);
          }
          log.debug(updateParams, 'updateNic: IP updated');

          return cb();
        });
      },

      function _getNic(_, cb) {
        log.debug(params, 'Getting nic "%s"', params.mac);
        return getNic(app, log, { mac: params.mac }, function (err, res) {
          if (err) {
            return cb(err);
          }

          updatedNic = res;
          return cb();
        });
      }

    ]}, function (err, res) {
      if (err) {
        return callback(err);
      }

      return callback(null, updatedNic);
    });
}


/*
 * Deletes a nic with the given parameters
 */
function deleteNic(app, log, params, callback) {
  log.debug(params, 'deleteNic: entry');
  var validatedParams;
  var nic;

  vasync.pipeline({
    funcs: [
    function _validate(_, cb) {
      validate.params({
        params: params,
        required: {
          mac: validateMAC
        }
      }, function (err, res) {
        validatedParams = res;
        return cb(err);
      });
    },

    // Need to get nic first, to see if it has an IP we need to delete
    function _get(_, cb) {
      return getNic(app, log, params, function (err, res) {
        nic = res;
        return cb(err);
      });
    },

    function _del(_, cb) {
      return mod_moray.delObj(app.moray, BUCKET,
        validatedParams.mac.toString(), cb);
    },

    function _delIP(_, cb) {
      if (!nic || !nic.ip) {
        log.debug('deleteNic: nic "%s" has no IP', params.mac);
        return callback();
      }

      // XXX: may want some way to override this and force the delete
      if (nic.ip.params.reserved) {
        log.debug('deleteNic: nic "%s" has a reserved IP', params.mac);
        return mod_ip.update(app, log, {
          ip: nic.ip.number,
          network_uuid: nic.network.params.uuid,
          belongs_to_uuid: nic.ip.params.belongs_to_uuid,
          belongs_to_type: nic.ip.params.belongs_to_type,
          unassign: true
        }, cb);

      } else {
        log.debug('deleteNic: nic "%s": deleting IP', params.mac);
        return mod_ip.del(app, log, {
          network_uuid: nic.network.uuid,
          ip: nic.ip.number
        }, cb);
      }
    }
  ]}, function (err) {
    if (err) {
      log.error(err, 'deleteNic: error');
    }
    return callback(err);
  });
}


/**
 * Gets a nic
 */
function getNic(app, log, params, callback) {
  log.debug(params, 'getNic: entry');

  validate.params({
    params: params,
    required: {
      mac: validateMAC
    }
  }, function (err, validatedParams) {
    if (err) {
      return callback(err);
    }

    mod_moray.getObj(app.moray, BUCKET, validatedParams.mac.toString(),
      function (err2, rec) {
      if (err2) {
        return callback(err2);
      }

      return createFromRaw(app, log, rec.value, callback);
    });
  });
}


/**
 * Lists nics
 */
function listNics(app, log, params, callback) {
  log.debug(params, 'listNics: entry');
  var nics = [];

  mod_moray.listObjs({
    defaultFilter: '(mac=*)',
    filter: params,
    log: log,
    bucket: BUCKET,
    moray: app.moray,
    sort: {
      attribute: 'mac',
      order: 'ASC'
    }
  }, function (err, res) {
    if (err) {
      return callback(err);
    }

    if (!res || res.length === 0) {
      return callback(null, []);
    }

    vasync.forEachParallel({
      inputs: res,
      func: function _listCreate(rec, cb) {
        createFromRaw(app, log, rec.value, function (err2, res2) {
          if (err2) {
            return cb(err2);
          }

          nics.push(res2);
          return cb();
        });
      }
    }, function (err3) {
      if (err3) {
        return callback(err3);
      }

      return callback(null, nics);
    });
  });
}


/**
 * Initializes the nic tags bucket
 */
function initNicsBucket(app, callback) {
  mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
  create: createNic,
  del: deleteNic,
  get: getNic,
  init: initNicsBucket,
  list: listNics,
  update: updateNic
};
