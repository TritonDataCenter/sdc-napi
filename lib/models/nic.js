/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * nic model
 */

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
var mod_nicTag = require('./nic-tag');
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
      // XXX: nic_tag and nic_tags_provided needed?
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
 * Ensure the nic tag with the given name exists
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
        util.format('nic tag%s do not exist', errTags.length === 1 ? '' : 's'));
      err.invalid = errTags;
      return callback(err);
    }

    return callback(null, tagArr);
  });
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
 * Creates a nic from the raw moray data
 */
function createFromRaw(app, log, params, callback) {
  var newNic;
  try {
    newNic = new Nic(params);
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
 * Provision an IP
 */
function provisionIP(app, log, params, callback) {
  var ip;
  var nic;
  var network;

  if (!params.network_uuid) {
    return callback(new Error('No network specified: not provisioning IP'));
  }

  vasync.pipeline({
    funcs: [
      // Ensure the network exists first
      function _getNet(_, cb) {

        var netParams = { uuid: params.network_uuid };
        log.debug(netParams, 'provisionIP: Getting network "%s"',
          params.network_uuid);

        return mod_net.get(app, log, netParams, function (err, res) {
          if (err) {
            return cb(err);
          }

          if (!res) {
            return cb(new verror.VError(
              'Unknown network "%s"', params.network_uuid));
          }

          network = res;
          return cb();
        });
      },

      // Get the nic: we need it to fill in (potentially) missing properties
      // for the IP
      function _getNic(_, cb) {
        // XXX: filter these params?
        log.debug(params, 'provisionIP: Getting nic "%s"', params.mac);
        return getNic(app, log, params, function (err, res) {
          if (err) {
            return cb(err);
          }

          nic = res;
          return cb();
        });
      },

      // Create the IP
      function _createProvisionIP(_, cb) {
        var ipParams = {
          network_uuid: network.uuid
        };

        // Use the existing nic's params as a base, and apply updates over
        // them
        var nicParams = nic.serialize();

        IP_PARAMS.forEach(function (p) {
          if (nicParams.hasOwnProperty(p)) {
            ipParams[p] = nicParams[p];
          }
          if (params.hasOwnProperty(p)) {
            ipParams[p] = params[p];
          }
        });

        ipParams.network = network;

        log.debug(ipParams, 'provisionIP: provisioning IP');
        return mod_ip.create(app, log, ipParams, function (err, res) {
          if (res) {
            ip = res;
          }

          return cb(err);
        });
      }

    ]}, function (err, res) {
      if (err) {
        return callback(err);
      }

      return callback(null, ip);
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

  if (params.hasOwnProperty('primary') &&
    typeof (params.primary) !== 'boolean') {
    this.params.primary = params.primary === 'true' ? true : false;
  }

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
  var network;
  var updateIPparams = {};

  vasync.pipeline({
    funcs: [
      function _validateParams(_, cb) {
        validate.params({
          params: params,
          required: {
            belongs_to_uuid: validate.UUID,
            belongs_to_type: validate.string,
            owner_uuid: validate.UUID
          },
          optional: {
            ip: validate.IP,
            model: validate.string,
            network_uuid: function (name, uuid, cb2) {
              validateNetworkUUID(name, uuid, function (err) {
                if (err) {
                  return cb2(err);
                }

                mod_net.get(app, log, { uuid: uuid }, function (err2, res) {
                  if (err2) {
                    return cb2(err2);
                  }

                  network = res;
                  params.network = res;
                  params.network_uuid = res.uuid;
                  return cb2(null, uuid);
                });
              });
            },
            nic_tags_provided: function (name, tags, cb2) {
              ensureNicTagsExist(app, log, name, tags, cb2);
            },
            reserved: validate.bool
          }
        }, function (err) {
          if (err) {
            return cb(err);
          }

          if (!params.mac) {
            // If no MAC specified, generate a random one based on the OUI in
            // the config
            // XXX: actually repeat here trying to find the next MAC
            params.mac = util_mac.randomNum(app.config.macOUI);
            log.info('createNic: no mac specified - generated "%s"',
              params.mac);
          }

          return cb();
        });
      },

      // If we want to create this nic with an IP, we need a network
      function _getNetwork(_, cb) {
        if (network) {
          return cb();
        }

        return findNetwork(app, log, params, function (err, res) {
          if (res) {
            network = res;
            params.network_uuid = res.uuid;
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
          if (err) {
            if (err.name === 'ResourceNotFoundError') {
              return cb();
            }

            return cb(err);
          }

          if (res.hasOwnProperty('belongs_to_uuid') &&
            res.belongs_to_uuid != constants.ADMIN_UUID) {
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
          nic = new Nic(params);
        } catch (err) {
          return cb(new restify.InvalidArgumentError(err.message));
        }

        if (network) {
          nic.network = network;
        }
        if (ip) {
          nic.ip = ip;
        }

        app.moray.putObject(BUCKET.name, nic.mac.toString(), nic.raw(),
          cb);
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
  var updatedNic;
  var updateParams;

  vasync.pipeline({
    funcs: [
      function _validate(_, cb) {
        validate.params({
          params: params,
          required: {
            mac: validateMAC
          },
          optional: {
            belongs_to_type: validate.string,
            belongs_to_uuid: validate.UUID,
            owner_uuid: validate.UUID,
            model: validate.string,
            nic_tags: function (name, tag, cb2) {
              ensureNicTagsExist(app, log, name, tag, cb2);
            },
            nic_tags_provided: function (name, tags, cb2) {
              ensureNicTagsExist(app, log, name, tags, cb2);
            },
            primary: validate.bool,
            reserved: validate.bool
          }
        }, function (err, res) {
          if (res && params.hasOwnProperty('nic_tags_provided')) {
            res.nic_tags_provided =
              util_common.arrayify(params.nic_tags_provided);
          }

          updateParams = res;
          return cb(err);
        });
      },

      function _provisionIP(_, cb) {
        if (!params.network_uuid) {
          return cb();
        }

        log.debug('provisioning IP for nic "%s"', params.mac);
        return provisionIP(app, log, params, function (err, res) {
          if (err) {
            return cb(err);
          }

          ip = res;
          updateParams.ip = ip.number;
          // Use the real network UUID from the newly-created IP: this
          // allows doing an update by name (like 'admin' for booter)
          updateParams.network_uuid = ip.params.network_uuid;

          return cb();
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

        if (!updatedNic.params.hasOwnProperty('ip') ||
          !updatedNic.params.hasOwnProperty('network_uuid')) {
          return cb();
        }

        var ipParams = {
          network_uuid: updatedNic.params.network_uuid,
          ip: updatedNic.params.ip
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
        // XXX: filter these params?
        log.debug(params, 'Getting nic "%s"', params.mac);
        return getNic(app, log, params, function (err, res) {
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
