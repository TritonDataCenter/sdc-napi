/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * network model and related functions
 */

var assert = require('assert');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_ip = require('./ip');
var mod_nicTag = require('./nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');



// --- Globals



var OBJ_CLASS = 'network';
var BASE_DN = 'ou=networks';
var VLAN_MSG = 'VLAN ID must be a number between 0 and 4094, and not 1';



// --- Internal helpers



/**
 * Creates a network from the raw UFDS data
 */
function createFromRaw(app, log, params, callback) {
  var ufdsToObj = {
    networkname: 'name',
    gatewayip: 'gateway',
    nictagname: 'nic_tag',
    provisionrangeendip: 'provision_end_ip',
    provisionrangestartip: 'provision_start_ip',
    resolverips: 'resolvers',
    uuid: 'uuid',
    vlan: 'vlan_id'
  };
  var properParams = { };

  util_common.translateParams(params, ufdsToObj, properParams);

  ['provision_start_ip', 'provision_end_ip', 'gateway',
    'subnet_start_ip'].forEach(function (ipParam) {
    if (properParams.hasOwnProperty(ipParam)) {
      properParams[ipParam] = util_ip.numberToAddress(properParams[ipParam]);
    }
  });

  if (params.hasOwnProperty('subnetbits') &&
    params.hasOwnProperty('subnetstartip')) {
    properParams.subnet = util.format('%s/%s',
      util_ip.numberToAddress(params.subnetstartip),
      params.subnetbits);
  }

  if (properParams.hasOwnProperty('resolvers')) {
    properParams.resolvers = util_common.arrayify(properParams.resolvers)
      .map(function (ipNum) {
        return util_ip.numberToAddress(ipNum);
    });
  }

  log.debug(properParams, 'CreateFromRaw: creating network');
  return createValidNetwork(app, log, properParams, callback);
}


/*
 * Translates restify parameters into their UFDS equivalents
 */
function paramsToUFDS(params) {
  var raw = {};
  var map = {
    uuid: 'uuid',
    name: 'networkname',
    vlan_id: 'vlan',
    nic_tag: 'nictagname'
  };
  for (var p in map) {
    if (params.hasOwnProperty(p)) {
      raw[map[p]] = params[p];
    }
  }
  return raw;
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
  var subnet = params.subnet.split('/');

  this.params = {
    name: params.name,
    nic_tag: params.nic_tag,
    provision_end_ip: util_ip.addressToNumber(params.provision_end_ip),
    provision_start_ip: util_ip.addressToNumber(params.provision_start_ip),
    subnet_bits: Number(subnet[1]),
    subnet_start_ip: util_ip.addressToNumber(subnet[0]),
    uuid: params.uuid,
    vlan_id: Number(params.vlan_id)
  };

  if (!params.uuid) {
    this.params.uuid = UUID.v4();
  }

  if (params.gateway) {
    this.params.gateway = util_ip.addressToNumber(params.gateway);
  }

  if (params.resolvers) {
    this.params.resolvers = util_common.arrayify(params.resolvers)
      .map(function (r) {
        return util_ip.addressToNumber(r);
    });
  }

  this.minIP = this.params.subnet_start_ip;
  this.maxIP = this.minIP + Math.pow(2, 32 - this.params.subnet_bits) - 1;

  this.__defineGetter__('uuid', function () { return this.params.uuid; });
}


/**
 * Returns the relative dn
 */
Network.prototype.dn = function networkDN() {
  return util.format('uuid=%s, %s', this.params.uuid, BASE_DN);
};


/**
 * Returns the raw form suitable for storing in UFDS
 */
Network.prototype.raw = function networkRaw() {
  var raw = {
    uuid: this.params.uuid,
    networkname: this.params.name,
    vlan: this.params.vlan_id,
    subnetstartip: this.params.subnet_start_ip,
    subnetbits: this.params.subnet_bits,
    provisionrangestartip: this.params.provision_start_ip,
    provisionrangeendip: this.params.provision_end_ip,
    nictagname: this.params.nic_tag
  };

  if (this.params.gateway) {
    raw.gatewayip = this.params.gateway;
  }

  if (this.params.resolvers) {
    raw.resolverips = this.params.resolvers;
  }

  return raw;
};


/**
 * Returns the LDAP objectclass
 */
Network.prototype.objectClass = function networkObjectClass() {
  return OBJ_CLASS;
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

  createValidNetwork(app, log, params, function (err, network) {
    if (err) {
      return callback(err);
    }

    return app.ufds.add(network, function afterNetworkCreate(err3, res) {
      if (err3) {
        return callback(err3);
      }

      // Create IPs for the gateway and resolvers (if they're in the same
      // subnet): this reserves those IPs by default

      var minIP = network.params.subnet_start_ip;
      var maxIP = minIP + Math.pow(2, 32 - network.params.subnet_bits) - 1;
      var ipsToCreate = [];

      if (network.params.gateway) {
        ipsToCreate.push(network.params.gateway);
      }
      for (var i in network.params.resolvers) {
        var num = network.params.resolvers[i];
        if ((minIP <= num) && (num <= maxIP) &&
          (ipsToCreate.indexOf(num) === -1)) {
          ipsToCreate.push(num);
        }
      }

      if (ipsToCreate.length === 0) {
        log.debug('No IPs to create for network %s', network.params.uuid);
        return callback(null, network);
      }

      return vasync.forEachParallel({
        inputs: ipsToCreate,
        func: function _createIP(ipNum, cb) {
          var ipParams = {
            belongs_to_type: 'other',
            belongs_to_uuid: constants.ADMIN_UUID,
            ip: ipNum,
            network_uuid: network.params.uuid,
            owner_uuid: constants.ADMIN_UUID,
            reserved: true
          };

          log.debug(ipParams, 'Creating IP %s for network %s',
            util_ip.numberToAddress(ipNum), network.params.uuid);
          return mod_ip.create(app, log, ipParams, cb);
        }
      }, function (err4, results) {
        if (err4) {
          return callback(err4);
        }

        return callback(null, network);
      });
    });
  });
}


/**
 * Lists networks, filtering by parameters
 */
function listNetworks(app, log, params, callback) {
  log.debug(params, 'listNetworks: entry');

  var filter = paramsToUFDS(params);
  var listParams = {
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    createFunc: function (p, cb) { createFromRaw(app, log, p, cb); }
  };
  if (!util_common.hashEmpty(filter)) {
    listParams.filter = filter;
  }

  app.ufds.list(listParams, callback);
}


/**
 * Gets a network
 */
function getNetwork(app, log, params, callback) {
  log.debug(params, 'getNetwork: entry');
  // XXX: validate UUID here?

  var id;
  if (params.uuid === 'admin') {
    id = 'networkname=' + params.uuid;
  } else {
    id = 'uuid=' + params.uuid;
  }

  app.ufds.get({
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    id: id,
    createFunc: function (p, cb) { createFromRaw(app, log, p, cb); }
  }, callback);
}


/**
 * Deletes a network
 */
function deleteNetwork(app, log, params, callback) {
  log.debug(params, 'deleteNetwork: entry');
  app.ufds.del({
    baseDN: BASE_DN,
    id: util.format('uuid=%s', params.uuid),
    children: params.force ? true : false
  }, callback);
}



module.exports = {
  create: createNetwork,
  del: deleteNetwork,
  get: getNetwork,
  list: listNetworks,
  Network: Network
};
