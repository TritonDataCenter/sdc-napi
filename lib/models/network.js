/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * network model and related functions
 */

var assert = require('assert');
var constants = require('../util/constants');
var mod_ip = require('./ip');
var mod_nicTag = require('./nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



var OBJ_CLASS = 'network';
var BASE_DN = 'ou=networks';



// --- Internal helpers



/*
 * Creates a network from the raw UFDS data
 */
function createFromRaw(params, callback) {
  var ufdsToObj = {
    networkname: 'name',
    gatewayip: 'gateway',
    nictagname: 'nic_tag',
    provisionrangeendip: 'provision_end_ip',
    provisionrangestartip: 'provision_start_ip',
    resolverips: 'resolvers',
    subnetbits: 'subnet_bits',
    subnetstartip: 'subnet_start_ip',
    uuid: 'uuid',
    vlan: 'vlan_id'
  };
  var properParams = {};
  util_common.translateParams(params, ufdsToObj, properParams);

  var newNetwork;
  try {
    newNetwork = new Network(properParams);
  } catch (err) {
    return callback(err);
  }
  return callback(null, newNetwork);
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


/*
 * Ensure the nic tag with the given name exists
 */
function ensureNicTagExists(app, log, tagName, callback) {
  log.debug({tagName: tagName}, 'ensureNicTagExists: entry');
  if (!tagName) {
    log.debug('ensureNicTagExists: no tag name');
    return callback();
  }

  return mod_nicTag.get(app, log, { name: tagName }, function (err, res) {
    if (err || !res) {
      return callback(new restify.ResourceNotFoundError(
        util.format('Unknown nic tag "%s"', tagName)));
    }

    return callback();
  });
}


/*
 * Validate parameters to the network constructor
 */
function validateParams(params) {
  var required = ['name', 'vlan_id', 'provision_start_ip', 'provision_end_ip',
    'nic_tag'];

  // subnet is required if this is coming through the API rather than UFDS
  if (!params.hasOwnProperty('subnet_start_ip') ||
      !params.hasOwnProperty('subnet_bits')) {
    required.push('subnet');
  }

  var paramErr = util_common.requireParams(required, params);
  if (paramErr) {
    throw paramErr;
  }

  var parsedParams = {
    name: params.name,
    vlan_id: params.vlan_id,
    nic_tag: params.nic_tag
  };

  if (params.hasOwnProperty('subnet')) {
    var subnet = params.subnet.split('/');
    if (subnet.length != 2) {
      throw new restify.InvalidArgumentError('Invalid subnet format');
    }
    parsedParams.subnet_start_ip = util_ip.addressToNumber(subnet[0]);
    parsedParams.subnet_bits = subnet[1];
  } else {
    if (!util_ip.ntoa(params.subnet_start_ip)) {
      throw new restify.InvalidArgumentError('Invalid subnet start IP');
    }
    parsedParams.subnet_start_ip = params.subnet_start_ip;
    parsedParams.subnet_bits = params.subnet_bits;
  }

  if (params.hasOwnProperty('uuid')) {
    parsedParams.uuid = params.uuid;
  }

  var numbers = {
    vlan_id: 1,
    subnet_start_ip: 1,
    subnet_bits: 1,
    provision_start_ip: 1,
    provision_end_ip: 1
  };
  for (var n in numbers) {
    if (parsedParams.hasOwnProperty(n)) {
      parsedParams[n] = Number(parsedParams[n]);
    }
  }

  var ipParams = ['provision_start_ip', 'provision_end_ip', 'gateway'];
  var ipNum;

  for (var p in ipParams) {
    var ipParam = ipParams[p];
    if (params.hasOwnProperty(ipParam) && params[ipParam] !== '') {
      ipNum = params[ipParam];
      if (isNaN(ipNum)) {
        ipNum = util_ip.addressToNumber(params[ipParam]);
      }

      if (!ipNum) {
        throw new restify.InvalidArgumentError(util.format(
          '%s IP "%s" is invalid', ipParam, params[ipParam]));
      }
      parsedParams[ipParam] = ipNum;
    }
  }

  if (params.hasOwnProperty('resolvers')) {
    // Account for UFDS will return a scalar if there's only one, or
    // comma-separated resolvers on the commandline
    var resolverIPs = util_common.arrayify(params.resolvers);

    parsedParams.resolvers = [];
    for (var r in resolverIPs) {
      var ip = resolverIPs[r].replace(/\s+/, '');
      if (!ip) {
        continue;
      }

      ipNum = resolverIPs[r];
      if (isNaN(ipNum)) {
        ipNum = util_ip.addressToNumber(resolverIPs[r]);
      }
      if (!ipNum) {
        throw new restify.InvalidArgumentError(util.format(
          'Resolver IP "%s" is invalid', resolverIPs[r]));
      }
      parsedParams.resolvers.push(ipNum);
    }
  }

  return parsedParams;
}



// --- Network object



/*
 * Network model constructor
 */
function Network(params) {
  this.params = validateParams(params);
  if (!this.params.uuid) {
    this.params.uuid = UUID.v4();
  }
}


/*
 * Returns the relative dn
 */
Network.prototype.dn = function networkDN() {
  return util.format('uuid=%s, %s', this.params.uuid, BASE_DN);
};


/*
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


/*
 * Returns the LDAP objectclass
 */
Network.prototype.objectClass = function networkObjectClass() {
  return OBJ_CLASS;
};


/*
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


/*
 * Returns the network's UUID
 */
Network.prototype.uuid = function networkUUID() {
  return this.params.uuid;
};


/*
 * Returns a random IP in the network's provisionable range
 */
Network.prototype.randomIPnum = function networkRandomIPnum() {
  return Math.floor(Math.random() *
    Number(this.params.provision_end_ip - this.params.provision_start_ip))
    + Number(this.params.provision_start_ip);
};



// --- Exported functions



/*
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

  ensureNicTagExists(app, log, params.nic_tag, function (err) {
    if (err) {
      return callback(err);
    }

    try {
      var network = new Network(params);
    } catch (err2) {
      return callback(err2);
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
            ip: ipNum,
            network_uuid: network.params.uuid,
            reserved: true,
            belongs_to_uuid: constants.ADMIN_UUID,
            belongs_to_type: 'other'
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


/*
 * Lists networks, filtering by parameters
 */
function listNetworks(app, log, params, callback) {
  log.debug(params, 'listNetworks: entry');

  var filter = paramsToUFDS(params);
  var listParams = {
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    createFunc: createFromRaw
  };
  if (!util_common.hashEmpty(filter)) {
    listParams.filter = filter;
  }

  app.ufds.list(listParams, callback);
}


/*
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
    createFunc: createFromRaw
  }, callback);
}


/*
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
  list: listNetworks,
  create: createNetwork,
  get: getNetwork,
  del: deleteNetwork
};
