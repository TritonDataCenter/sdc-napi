/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * nic model
 */

var restify = require('restify');

var mod_ip = require('../util/ip');
var mod_mac = require('../util/mac');



// --- Internal helpers


/*
 * Finds the next free IP in a network
 */
function findNextFreeIP(app, netUUID) {
  var net = app.data.networks[netUUID];
  if (!net) {
    return new
      restify.ResourceNotFoundError("Unknown logical network '%s'", netUUID);
  }
  // Pick a random IP number to start at, and go upward from there
  var startAt = net.startIP + Math.floor(Math.random() * (net.endIP - net.startIP));
  var ip = startAt;
  while (ip != startAt - 1) {
    if (!net.ips.reserved.hasOwnProperty(ip)) {
      return ip;
    }
    ip++;
    if (ip == net.endIP + 1) {
      ip = net.startIP;
    }
  }

  return new restify.InternalError("No more free IPs in logical network '" + net.name + "'");
}


/*
 * Finds the next free MAC address
 */
function findNextFreeMAC(nics, macOUI) {
  // Pick a random MAC number to start at, and go upward from there
  var startAt = Math.floor(Math.random() * 16777215) + 1;
  var prefix = mod_mac.macOUItoNumber(macOUI);
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

  return new restify.InternalError("No more free MAC addresses");
}


/*
 * Ensures request has the required parameters - returns an error if
 * it doesn't.
 */
function validateParams(params) {
  var requiredParams = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type'];
  var missing = [];
  for (var p in requiredParams) {
    var param = requiredParams[p];
    if (!params.hasOwnProperty(param)) {
      missing.push(param); 
    }
  }

  if (missing.length != 0) {
    return new restify.MissingParameterError("Missing parameter%s: %s",
        missing.length == 1 ? '': 's', missing.join(', '));
  }

  // TODO: validate mac address (if present)

  return null;
}


// --- Nic object



/*
 * Looks up a nic in the data store by its integer representation of MAC
 * address. Returns an error if the nic is not found or the data is
 * inconsistent in any way.
 */
function lookupNicByMacNumber(app, macNum) {
  var address = mod_mac.macNumberToAddress(macNum);
  if (!address) {
    return new restify.InvalidArgumentError("Invalid MAC number '%d'", macNum);
  }

  var nicData = app.data.nics[macNum];
  if (!nicData) {
    return new restify.ResourceNotFoundError("Unknown MAC address '%s'", address);
  }

  var netUUID = nicData.network;
  return new Nic(app, netUUID, nicData.ip, macNum, nicData);
}


/*
 * Looks up a nic in the data store by MAC address. Returns an error if the nic
 * is not found or the data is inconsistent in any way.
 */
function lookupNicByMacAddress(app, macAddr) {
  var macNum = mod_mac.macAddressToNumber(macAddr);
  if (!macNum) {
    return new restify.InvalidArgumentError("Invalid MAC address '%d'", macAddr);
  }
  return lookupNicByMacNumber(app, macNum);
}


/*
 * Constructor for the Nic model
 */
function Nic(app, netUUID, ip, mac, params) {
  this.app = app;
  if (netUUID) {
    this.netUUID = netUUID;
    this.network = app.data.networks[netUUID];
    this.ip = ip;
  }
  this.mac = mac;
  this.params = params;
  this.primary = params.primary ? true : false;
}


/*
 * Returns the serialized form of the nic
 */
Nic.prototype.serialize = function() {
  var net = this.network;

  var serialized = {
    mac: mod_mac.macNumberToAddress(this.mac),
    primary: this.primary,
    owner_uuid: this.params.owner_uuid,
    belongs_to_uuid: this.params.belongs_to_uuid,
    belongs_to_type: this.params.belongs_to_type
  };

  if (net) {
    serialized.ip = mod_ip.numberToAddress(this.ip);
    serialized.netmask = mod_ip.numberToAddress(net.netmask);
    serialized.vlan_id = net.vlan;
    // XXX: should we keep track of nic?
    serialized.nic_tag = net.name; // XXX

    if (net.gateway) {
      serialized.gateway = mod_ip.numberToAddress(net.gateway);
    }

    serialized.resolvers = [];
    for (var r in net.resolvers) {
      serialized.resolvers.push(mod_ip.numberToAddress(net.resolvers[r]));
    }
  }

  return serialized;
}


/*
 * Updates the nic's data in the app - does not save it to disk, though.
 */
Nic.prototype.updateDataStore = function(app) {
  app.data.nics[this.mac] = {
    owner_uuid: this.params.owner_uuid,
    belongs_to_uuid: this.params.belongs_to_uuid,
    belongs_to_type: this.params.belongs_to_type
  };

  if (this.ip) {
    app.data.networks[this.netUUID].ips.reserved[this.ip] = {
      nic: this.mac,
      owner_uuid: this.params.owner_uuid,
      belongs_to_uuid: this.params.belongs_to_uuid,
      belongs_to_type: this.params.belongs_to_type
    };

    app.data.nics[this.mac].ip = this.ip;
    app.data.nics[this.mac].network = this.netUUID;
  }
}



// --- Exported functions



/*
 * Creates a new Nic, reserving a new IP and MAC in the process
 */
function createNic(app, log, netUUID, params, callback) {
  var paramErr = validateParams(params);
  if (paramErr != null) {
    return callback(paramErr);
  }

  var ip = null;
  if (netUUID) {
    ip = findNextFreeIP(app, netUUID);
    if (ip instanceof Error) {
      return callback(ip);
    }
  }

  if (params.hasOwnProperty('mac')) {
    mac = mod_mac.macAddressToNumber(params.mac);
    console.log("mac=" + mac);
    if (!mac) {
      return callback(
        new restify.InvalidArgumentError("Invalid MAC address '%s'",
          params.mac));
    }
    if (app.data.nics.hasOwnProperty(mac)) {
      return callback(new restify.InvalidArgumentError(
          "MAC address '%s' already exists", params.mac));
    }
  } else {
    mac = findNextFreeMAC(app.data.nics, app.config.macOUI);
    if (mac instanceof Error) {
      return callback(mac);
    }
  }

  var newNic = new Nic(app, netUUID, ip, mac, params);
  newNic.updateDataStore(app);

  app.writeDataFile(function(err) {
    if (err) {
      // XXX: bubble up a nicer error
      return callback(err);
    }

    return callback(null, newNic);
  });
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
    return callback(new restify.ResourceNotFoundError("Unknown network %s", uuid));
  }

  var paramErr = validateParams(params);
  if (paramErr != null) {
    return callback(paramErr);
  }

  if (!app.data.hasOwnProperty('nics')) {
    app.data.nics = {};
  }

  var net = networks[uuid];
  if (!net.hasOwnProperty('ips')) {
    net.ips = {}; 
  }
  if (!net.ips.hasOwnProperty('reserved')) {
    net.ips.reserved = {};
  }

  createNic(app, log, uuid, params, callback);
}


/*
 * Updates a nic with the given parameters
 */
function updateNic(app, params, callback) {
  var nic = lookupNicByMacAddress(app, params.mac_address);
  if (nic instanceof Error) {
    return callback(nic);
  }

  var canUpdate = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type'];

  for (var c in canUpdate) {
    var param = canUpdate[c];
    if (params.hasOwnProperty(param)) {
      nic.params[param] = params[param];
    }
  }
  // TODO: return error if we haven't updated anything
  nic.updateDataStore(app);

  app.writeDataFile(function(err) {
    if (err) {
      // XXX: bubble up a nicer error
      return callback(err);
    }

    return callback(null, nic)
  });
}


/*
 * Returns true if the nic matches ALL of the params to filter on (currently
 * only supports matching on owner_uuid, belongs_to_uuid and belongs_to_type)
 */
function matchNic(nic, params) {
  var toCheck = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type'];

  for (var c in toCheck) {
    var param = toCheck[c];
    if (params.hasOwnProperty(param) && params[param] != nic.params[param]) {
      return false;
    }
  }

  return true;
}



module.exports = {
  createNic: createNic,
  provisionNic: provisionNic,
  updateNic: updateNic,
  matchNic: matchNic,
  lookupNicByMacNumber: lookupNicByMacNumber,
  lookupNicByMacAddress: lookupNicByMacAddress
};
