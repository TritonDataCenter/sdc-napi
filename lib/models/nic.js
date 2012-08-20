/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * nic model
 */

var util = require('util');

var restify = require('restify');

var mod_ip = require('./ip');
var mod_net = require('./network');
var util_ip = require('../util/ip');
var util_mac = require('../util/mac');



// --- Internal helpers



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
 * Ensures request has the required parameters - returns an error if
 * it doesn't.
 */
function validateParams(requiredParams, params) {
  var missing = [];
  for (var p in requiredParams) {
    var param = requiredParams[p];
    if (!params.hasOwnProperty(param)) {
      missing.push(param);
    }
  }

  if (missing.length != 0) {
    return new restify.MissingParameterError('Missing parameter%s: %s',
        missing.length == 1 ? '': 's', missing.join(', '));
  }

  // TODO: validate mac address (if present)

  return null;
}


/*
 * Ensures request has the parameters required for all requests
 */
function validateRequiredParams(params) {
  return validateParams(['owner_uuid', 'belongs_to_uuid', 'belongs_to_type'],
      params);
}



// --- Nic object



/*
 * Constructor for the Nic model
 */
function Nic(app, ip, mac, params) {
  this.app = app;
  if (ip) {
    this.ip = ip;
  }
  this.mac = mac;
  this.params = params;
  this.primary = params.primary ? true : false;
}


/*
 * Returns the serialized form of the nic
 */
Nic.prototype.serialize = function () {
  var serialized = {
    mac: util_mac.macNumberToAddress(this.mac),
    primary: this.primary,
    owner_uuid: this.params.owner_uuid,
    belongs_to_uuid: this.params.belongs_to_uuid,
    belongs_to_type: this.params.belongs_to_type
  };

  if (this.ip) {
    var ipSer = this.ip.serializeWithNetwork();
    for (var s in ipSer) {
      serialized[s] = ipSer[s];
    }
  }

  if (this.params.nic_tags_provided) {
    serialized.nic_tags_provided = this.params.nic_tags_provided;
  }

  return serialized;
};


/*
 * Gets a nic property
 */
Nic.prototype.property = function (propName) {
  var propVal = null;
  var ip = this.ip;
  var paramProps = {
    'owner_uuid': 1,
    'belongs_to_uuid': 1,
    'belongs_to_type': 1
  };
  var netProps = {
      'nic_tag': 1
  };

  if (paramProps.hasOwnProperty(propName)) {
    return this.params[propName];
  }

  if (netProps.hasOwnProperty(propName) && ip) {
    if (propName == 'nic_tag') {
      propVal = ip.network.name;
    }
  }

  return propVal;
};


/*
 * Gets the numeric representation of the nic's MAC address
 */
Nic.prototype.number = function () {
  return this.mac;
};


/*
 * Updates the IP in the datastore
 */
Nic.prototype.updateIP = function (app, callback) {
  if (!this.ip) {
    return callback(null);
  }
  return this.ip.updateDataStore(app, callback);
};


/*
 * Updates the datastore with the nic's data, (and the ip data, if it has one)
 */
Nic.prototype.updateDataStore = function (app, callback) {
  var self = this;
  this.updateIP(app, function (err) {
    if (err) {
      return callback(err);
    }

    app.data.nics[self.mac] = {
      owner_uuid: self.params.owner_uuid,
      belongs_to_uuid: self.params.belongs_to_uuid,
      belongs_to_type: self.params.belongs_to_type
    };
    if (self.ip) {
      app.data.nics[self.mac].ip = self.ip.number();
      app.data.nics[self.mac].network = self.ip.netUUID;
    }

    if (self.params.nic_tags_provided) {
      app.data.nics[self.mac].nic_tags_provided = self.params.nic_tags_provided;
    }

    app.writeDataFile(function (e) {
      if (e) {
        // XXX: bubble up a nicer error
        return callback(e);
      }

      return callback(null);
    });

    return null;
  });
};


/*
 * Deletes the IP associated with this nic
 */
Nic.prototype.deleteIP = function (app, callback) {
  if (!this.ip) {
    return callback(null);
  }
  return this.ip.deleteFromDataStore(app, callback);
};


/*
 * Deletes the nic's data from the datastore (and the ip, if it exists and
 * is not reserved)
 */
Nic.prototype.deleteFromDataStore = function (app, callback) {
  var mac = this.mac;
  this.deleteIP(app, function (err) {
    if (err) {
      return callback(err);
    }

    delete app.data.nics[mac];

    app.writeDataFile(function (e) {
      if (e) {
        // XXX: bubble up a nicer error
        return callback(e);
      }

      return callback(null);
    });

    return null;
  });
};



// --- Exported functions



/*
 * Creates a new Nic, reserving a new IP and MAC in the process
 */
function createNic(app, log, netUUID, params, callback) {
  var paramErr = validateRequiredParams(params);
  if (paramErr != null) {
    return callback(paramErr);
  }

  var ip = null;
  var mac = null;

  // If we don't have a network, try to figure one out based on the
  // other parameters
  if (!netUUID && params.ip) {
    var netParams = ['nic_tag', 'vlan_id'];
    paramErr = validateParams(netParams.concat(['ip']), params);
    // TODO: make sure these are valid IP addrs
    if (paramErr != null) {
      return callback(paramErr);
    }
    var matching = mod_net.listNetworkUUIDs(app, params, netParams, log);
    if (matching.length != 1) {
      return callback(new restify.InternalError(
            'Could not find a logical network matching those parameters.'));
    }
    netUUID = matching[0];
  }

  if (netUUID) {
    var ipParams = {
      network: netUUID,
      address: params.ip,
      owner_uuid: params.owner_uuid,
      belongs_to_uuid: params.belongs_to_uuid,
      belongs_to_type: params.belongs_to_type
    };
    if (params.hasOwnProperty('reserved') && params.reserved == 'true') {
      ipParams.reserved = true;
    }
    ip = mod_ip.createIP(app, ipParams);
    if (ip instanceof Error) {
      return callback(ip);
    }
  }

  if (params.hasOwnProperty('mac')) {
    mac = util_mac.macAddressToNumber(params.mac);
    if (!mac) {
      return callback(
        new restify.InvalidArgumentError('Invalid MAC address "%s"',
          params.mac));
    }
    if (app.data.nics.hasOwnProperty(mac)) {
      return callback(new restify.InvalidArgumentError(
          'MAC address "%s" already exists', params.mac));
    }
  } else {
    mac = findNextFreeMAC(app.data.nics, app.config.macOUI);
    if (mac instanceof Error) {
      return callback(mac);
    }
  }

  var newNic = new Nic(app, ip, mac, params);

  if (ip) {
    ip.nic = newNic.number();
  }

  newNic.updateDataStore(app, function (err) {
    if (err) {
      return callback(err);
    }
    return callback(null, newNic);
  });

  return null;
}


/*
 * Provisions a new nic
 */
function provisionNic(app, log, params, callback) {
  var networks = app.data.networks;
  var uuid = params.network_uuid;

  // TODO: enforce only one nic for a zone being the primary

  // XXX: this should be moved out into its own 'find network' function
  if (uuid == 'admin') {
    for (var n in networks) {
      if (networks[n].name == 'admin') {
        uuid = n;
        break;
      }
    }
  }
  if (!networks.hasOwnProperty(uuid)) {
    return callback(new restify.ResourceNotFoundError(
          'Unknown network "%s"', uuid));
  }

  var paramErr = validateRequiredParams(params);
  if (paramErr != null) {
    return callback(paramErr);
  }

  createNic(app, log, uuid, params, callback);
  return null;
}


/*
 * Updates a nic with the given parameters
 */
function updateNic(app, params, callback) {
  var nic = lookupNicByMacAddress(app, params.mac_address);
  if (nic instanceof Error) {
    return callback(nic);
  }

  var canUpdate = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type',
      'nic_tags_provided'];

  for (var c in canUpdate) {
    var param = canUpdate[c];
    if (params.hasOwnProperty(param)) {
      nic.params[param] = params[param];
    }
  }
  // TODO: return error if we haven't updated anything
  return nic.updateDataStore(app, function (err) {
    if (err) {
      return callback(err);
    }
    return callback(null, nic);
  });
}


/*
 * Deletes a nic with the given parameters
 */
function deleteNic(app, log, params, callback) {
  var nic = lookupNicByMacAddress(app, params.mac_address);
  if (nic instanceof Error) {
    return callback(nic);
  }

  // TODO: return error if we haven't updated anything
  return nic.deleteFromDataStore(app, callback);
}


/*
 * Returns true if the nic matches ALL of the params to filter on (currently
 * only supports matching on owner_uuid, belongs_to_uuid, belongs_to_type,
 * and nic_tag)
 */
function matchNic(nic, params) {
  var validParams = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type',
      'nic_tag'];

  for (var v in validParams) {
    var param = validParams[v];
    if (!params.hasOwnProperty(param)) {
      continue;
    }

    var nicParam = nic.property(param);
    var paramsArr = params[param].split(',');
    var match = false;
    for (var p in paramsArr) {
      var val = paramsArr[p];
      if (val == nicParam) {
        match = true;
      }
    }

    if (!match) {
      return false;
    }
  }

  return true;
}


/*
 * Looks up a nic in the data store by its integer representation of MAC
 * address. Returns an error if the nic is not found or the data is
 * inconsistent in any way.
 */
function lookupNicByMacNumber(app, macNum) {
  var address = util_mac.macNumberToAddress(macNum);
  if (!address) {
    return new restify.InvalidArgumentError('Invalid MAC number "%d"', macNum);
  }

  var nicData = app.data.nics[macNum];
  if (!nicData) {
    return new restify.ResourceNotFoundError(
        'Unknown MAC address "%s"', address);
  }

  var ip;
  if (nicData.ip) {
    var netUUID = nicData.network;
    ip = mod_ip.getIP(app, netUUID, nicData.ip);
  }

  return new Nic(app, ip, macNum, nicData);
}


/*
 * Looks up a nic in the data store by MAC address. Returns an error if the nic
 * is not found or the data is inconsistent in any way.
 */
function lookupNicByMacAddress(app, macAddr) {
  var macNum = util_mac.macAddressToNumber(macAddr);
  if (!macNum) {
    return new restify.InvalidArgumentError(
        'Invalid MAC address "%d"', macAddr);
  }
  return lookupNicByMacNumber(app, macNum);
}



module.exports = {
  createNic: createNic,
  deleteNic: deleteNic,
  lookupNicByMacAddress: lookupNicByMacAddress,
  lookupNicByMacNumber: lookupNicByMacNumber,
  matchNic: matchNic,
  provisionNic: provisionNic,
  updateNic: updateNic
};
