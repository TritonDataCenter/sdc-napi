/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * network model and related functions
 */

var assert = require('assert');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var mod_nicTag = require('./nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');



// --- Globals



var BUCKET = {
  desc: 'network',
  name: 'napi_networks',
  schema: {
    index: {
      name: { type: 'string', unique: true },
      nic_tag: { type: 'string' },
      uuid: { type: 'string', unique: true },
      vlan_id: { type: 'number' }
    }
  }
};
var VLAN_MSG = 'VLAN ID must be a number between 0 and 4094, and not 1';



// --- Internal helpers



/**
 * Returns parameters for creating an IP: reserved, belongs to admin,
 * type 'other'
 */
function adminReservedIP(network, ipNum) {
  return {
    belongs_to_type: 'other',
    belongs_to_uuid: constants.ADMIN_UUID,
    ip: ipNum,
    network_uuid: network.params.uuid,
    owner_uuid: constants.ADMIN_UUID,
    reserved: true
  };
}


/**
 * Ensure the nic tag with the given name exists
 */
function ensureNicTagExists(app, log, tagName, callback) {
  if (tagName === null) {
    return callback(new restify.InvalidArgumentError(
      'nic tag not specified'));
  }

  return mod_nicTag.get(app, log, { name: tagName }, function (err, res) {
    if (err || !res) {
      return callback(new restify.ResourceNotFoundError(
        util.format('Unknown nic tag "%s"', tagName)));
    }

    return callback();
  });
}


/**
 * Validates a VLAN ID
 */
function validateVLAN(name, vlan_id, callback) {
  var id = Number(vlan_id);
  if (isNaN(id) || id < 0 ||
    id === 1 || id > 4094) {
    return callback(errors.invalidParam('vlan_id', VLAN_MSG));
  }

  return callback(null, id);
}


/**
 * Validates that the provision start and end IPs are within the subnet,
 * and that end doesn't come before start.
 */
function validateProvisionRange(parsedParams, callback) {
  if (!parsedParams.subnet_start_ip || !parsedParams.subnet_bits) {
    return callback();
  }

  var errs = [];
  var minIP = parsedParams.subnet_start_ip;
  var maxIP = minIP + Math.pow(2, 32 - parsedParams.subnet_bits) - 1;

  if (parsedParams.provision_start_ip) {
    if ((parsedParams.provision_start_ip < minIP) ||
      (parsedParams.provision_start_ip > maxIP)) {
      errs.push(errors.invalidParam('provision_start_ip',
       'provision_start_ip cannot be outside subnet'));
      delete parsedParams.provision_start_ip;
    }

    if (parsedParams.provision_start_ip == maxIP) {
      errs.push(errors.invalidParam('provision_start_ip',
       'provision_start_ip cannot be the broadcast address'));
      delete parsedParams.provision_start_ip;
    }
  }

  if (parsedParams.provision_end_ip) {
    if ((parsedParams.provision_end_ip < minIP) ||
    (parsedParams.provision_end_ip > maxIP)) {
     errs.push(errors.invalidParam('provision_end_ip',
      'provision_end_ip cannot be outside subnet'));
      delete parsedParams.provision_end_ip;
    }

    if (parsedParams.provision_end_ip == maxIP) {
      errs.push(errors.invalidParam('provision_end_ip',
       'provision_end_ip cannot be the broadcast address'));
      delete parsedParams.provision_end_ip;
    }
  }

  if (parsedParams.provision_end_ip && parsedParams.provision_start_ip &&
    (parsedParams.provision_end_ip <= parsedParams.provision_start_ip)) {
    var msg = 'provision_start_ip must be before provision_end_ip';
    errs.push(errors.invalidParam('provision_end_ip', msg));
    errs.push(errors.invalidParam('provision_start_ip', msg));
  }

  if (errs.length !== 0) {
    return callback(errs);
  }

  return callback();
}


/**
 * Validates parameters and returns a network object if all parameters are
 * valid, or an error otherwise
 */
function createValidNetwork(app, log, params, callback) {
  // XXX: validate non-duplicate name
  validate.params({
    params: params,
    required: {
      name: validate.string,
      nic_tag: function (name, tag, cb) {
        ensureNicTagExists(app, log, tag, function (err) {
          if (err) {
            return cb(errors.invalidParam(name, 'nic tag does not exist'));
          }
          return cb(null, tag);
        });
      },
      provision_end_ip: validate.IP,
      provision_start_ip: validate.IP,
      subnet: validate.subnet,
      vlan_id: validateVLAN
    },
    optional: {
      description: validate.string,
      // Allow gateway to be empty
      gateway: function (name, val, cb) {
        if (val === null || val === '') {
          return cb();
        }

        return validate.IP(name, val, cb);
      },
      resolvers: validate.ipArray,
      uuid: validate.UUID
    },
    after: validateProvisionRange
  }, function (err, validatedParams) {
    if (err) {
      return callback(err);
    }

    return callback(null, new Network(params));
  });
}



// --- Network object



/**
 * Network model constructor
 */
function Network(params) {
  var subnet = params.subnet ? params.subnet.split('/') :
    [params.subnet_start_ip, params.subnet_bits];

  this.params = {
    name: params.name,
    nic_tag: params.nic_tag,
    provision_end_ip: Number(params.provision_end_ip) ||
      util_ip.addressToNumber(params.provision_end_ip),
    provision_start_ip: Number(params.provision_start_ip) ||
      util_ip.addressToNumber(params.provision_start_ip),
    subnet_bits: Number(subnet[1]),
    subnet_start_ip: Number(subnet[0]) ||
      util_ip.addressToNumber(subnet[0]),
    uuid: params.uuid,
    vlan_id: Number(params.vlan_id)
  };

  if (!params.uuid) {
    this.params.uuid = UUID.v4();
  }

  if (params.gateway) {
    this.params.gateway = Number(params.gateway) ||
      util_ip.addressToNumber(params.gateway);
  }

  if (params.hasOwnProperty('description')) {
    this.params.gateway = params.description;
  }

  if (params.resolvers) {
    this.params.resolvers = util_common.arrayify(params.resolvers)
      .map(function (r) {
        return Number(r) || util_ip.addressToNumber(r);
    });
  }

  this.minIP = this.params.subnet_start_ip;
  this.maxIP = this.minIP + Math.pow(2, 32 - this.params.subnet_bits) - 1;

  this.provisionMin = this.params.provision_start_ip;
  this.provisionMax = this.params.provision_end_ip;

  this.__defineGetter__('uuid', function () { return this.params.uuid; });
}


/**
 * Returns the raw form suitable for storing in UFDS
 */
Network.prototype.raw = function networkRaw() {
  var raw = {
    uuid: this.params.uuid,
    name: this.params.name,
    vlan_id: this.params.vlan_id,
    subnet_start_ip: this.params.subnet_start_ip,
    subnet_bits: this.params.subnet_bits,
    provision_start_ip: this.params.provision_start_ip,
    provision_end_ip: this.params.provision_end_ip,
    nic_tag: this.params.nic_tag
  };

  if (this.params.gateway) {
    raw.gateway = this.params.gateway;
  }

  if (this.params.hasOwnProperty('description')) {
    raw.description = this.params.description;
  }

  if (this.params.resolvers) {
    raw.resolvers = this.params.resolvers;
  }

  return raw;
};


/**
 * Returns the serialized form of the network
 */
Network.prototype.serialize = function networkSerialize() {
  var ser = {
    uuid: this.params.uuid,
    name: this.params.name,
    vlan_id: this.params.vlan_id,
    subnet: util.format('%s/%d',
      util_ip.numberToAddress(this.params.subnet_start_ip),
      this.params.subnet_bits),
    netmask: util_ip.bitsToNetmask(this.params.subnet_bits),
    provision_start_ip: util_ip.numberToAddress(this.params.provision_start_ip),
    provision_end_ip: util_ip.numberToAddress(this.params.provision_end_ip),
    nic_tag: this.params.nic_tag
  };

  var resolvers = [];
  for (var r in this.params.resolvers) {
    resolvers.push(util_ip.numberToAddress(this.params.resolvers[r]));
  }
  ser.resolvers = resolvers;

  if (this.params.gateway) {
    ser.gateway = util_ip.numberToAddress(this.params.gateway);
  }

  if (this.params.hasOwnProperty('description')) {
    ser.description = this.params.description;
  }

  return ser;
};


/**
 * Returns a random IP in the network's provisionable range
 */
Network.prototype.randomIPnum = function networkRandomIPnum() {
  return Math.floor(Math.random() *
    Number(this.params.provision_end_ip - this.params.provision_start_ip))
    + Number(this.params.provision_start_ip);
};



// --- Exported functions



/**
 * Creates a new network
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `name` {String}: network name (required)
 * - `gateway` {IP}: gateway
 * - `nic_tag` {String}: nic tag name (required)
 * - `provision_start_ip` {IP}: start address for provision range (required)
 * - `provision_end_ip` {IP}: end address for provision range (required)
 * - `resolvers` {IP Array}: DNS resolvers
 * - `vlan_id` {Number}: VLAN ID (required)
 * @param callback {Function} `function (err, netObj)`
 */
function createNetwork(app, log, params, callback) {
  log.debug(params, 'createNetwork: entry');
  var network;

  vasync.pipeline({
    funcs: [
    function _createNetObj(_, cb) {
      createValidNetwork(app, log, params, function (err, res) {
        if (err) {
          return cb(err);
        }

        network = res;
        return cb();
      });
    },

    function _createNet(_, cb) {
      app.moray.putObject(BUCKET.name, network.uuid, network.raw(), cb);
    },

    function _createIPbucket(_, cb) {
      mod_ip.bucketInit(app, network.uuid, cb);
    },

    function _createIPs(_, cb) {
      // Create reserved IP records for:
      // * gateway (if specified)
      // * resolvers (if they're in the same subnet)
      // * broadcast address

      var ipsToCreate = {};

      if (network.params.gateway) {
        ipsToCreate[network.params.gateway] =
          adminReservedIP(network, network.params.gateway);
      }

      for (var r in network.params.resolvers) {
        var num = network.params.resolvers[r];
        if ((network.minIP <= num) && (num <= network.maxIP) &&
          !ipsToCreate.hasOwnProperty(num)) {
          ipsToCreate[num] = adminReservedIP(network, num);
        }
      }

      // Don't allow provisioning on the broadcast address
      if (!ipsToCreate.hasOwnProperty(network.maxIP)) {
        ipsToCreate[network.maxIP] = adminReservedIP(network, network.maxIP);
      }

      // Add the IPs just outside the provision range to moray, so that
      // finding gaps in the range works properly.  Note that these records
      // can be outside the subnet, but we will never use them: they're just
      // markers.
      [network.provisionMin - 1, network.provisionMax + 1].forEach(
        function (rangeNum) {
        if (!ipsToCreate.hasOwnProperty(rangeNum)) {
          ipsToCreate[rangeNum] = { ip : rangeNum, reserved: false };
        }
      });

      var batch = {
        batch: Object.keys(ipsToCreate).sort().map(function (i) {
          return ipsToCreate[i];
        }),
        network_uuid: network.uuid
      };

      // XXX: should create the network and the IPs in the same batch
      log.info(batch, 'Reserving IPs for network "%s"', network.uuid);
      return mod_ip.batchCreate(app, log, batch, cb);
    }

    ]
  }, function (err, res) {
    if (err) {
      return callback(err);
    }

    return callback(null, network);
  });
}


/**
 * Lists networks, filtering by parameters
 */
function listNetworks(app, log, params, callback) {
  log.debug(params, 'listNetworks: entry');

  mod_moray.listObjs({
    defaultFilter: '(uuid=*)',
    filter: params,
    log: log,
    bucket: BUCKET,
    model: Network,
    moray: app.moray,
    sort: {
      attribute: 'name',
      order: 'ASC'
    }
  }, callback);
}


/**
 * Gets a network
 */
function getNetwork(app, log, params, callback) {
  log.debug(params, 'getNetwork: entry');

  if (params.uuid === 'admin') {
    return mod_moray.listObjs({
      filter: '(name=admin)',
      log: log,
      bucket: BUCKET,
      model: Network,
      moray: app.moray,
      sort: {
        attribute: 'name',
        order: 'ASC'
      }
    }, function (err, list) {
      if (err) {
        return callback(err);
      }

      if (list.length > 1) {
        log.warn(list.map(function (n) { return n.serialize(); }),
          'more than 1 admin network found');
      }

      return callback(null, list[0]);
    });
  }

  validate.params({
    params: params,
    required: {
      uuid: validate.UUID
    }
  }, function (err) {
    if (err) {
      return callback(err);
    }

    mod_moray.getObj(app.moray, BUCKET, params.uuid, function (err2, rec) {
      if (err2) {
        return callback(err2);
      }

      return callback(null, new Network(rec.value));
    });
  });
}


/**
 * Deletes a network
 */
function deleteNetwork(app, log, params, callback) {
  log.debug(params, 'deleteNetwork: entry');

  validate.params({
    params: params,
    required: {
      uuid: validate.UUID
    }
  }, function (err) {
    if (err) {
      return callback(err);
    }

    mod_moray.delObj(app.moray, BUCKET, params.uuid, function (err2) {
      if (err2) {
        return callback(err2);
      }

      var ipsBucket = mod_ip.bucket(params.uuid);
      app.moray.delBucket(ipsBucket.name, function (err3) {
        // The 'does not exist' error just means there were no IPs in this
        // network yet, so we haven't created the bucket
        if (err3 && err3.message.indexOf('does not exist') === -1) {
          return callback(err3);
        }

        return callback();
      });
    });
  });
}


/**
 * Initializes the networks bucket
 */
function initNetworksBucket(app, callback) {
  mod_moray.initBucket(app.moray, BUCKET, callback);
}



module.exports = {
  create: createNetwork,
  del: deleteNetwork,
  get: getNetwork,
  init: initNetworksBucket,
  list: listNetworks,
  Network: Network
};
