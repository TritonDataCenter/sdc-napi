/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * IP model
 */


var restify = require('restify');

var util_ip = require('../util/ip');
var util_mac = require('../util/mac');



// --- Internal helpers



/*
 * Finds the next free IP in a network
 */
function findNextFreeIP(app, netUUID) {
  var net = app.data.networks[netUUID];
  if (!net) {
    return new
      restify.ResourceNotFoundError('Unknown logical network "%s"', netUUID);
  }
  // Pick a random IP number to start at, and go upward from there
  var startAt = net.startIP + Math.floor(Math.random() *
      (net.endIP - net.startIP));
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

  return new restify.InternalError(
        'No more free IPs in logical network "%s"', net.name);
}


/*
 * Finds a specific IP in a network: if free, returns the IP number. If
 * taken, returns an error. An IP is free if either:
 * - it doesn't exist in the data store
 * - it does exist but it doesn't have a belongs_to_uuid
 */
function findFreeIPbyAddress(app, netUUID, addr) {
  var net = app.data.networks[netUUID];
  if (!net) {
    return new
      restify.ResourceNotFoundError('Unknown logical network "%s"', netUUID);
  }

  // TODO: make sure IP is actually in this network
  var ip = util_ip.addressToNumber(addr);
  if (!ip) {
    return new restify.InvalidArgumentError('Invalid IP address "%s"', addr);
  }

  if (!net.ips.reserved.hasOwnProperty(ip)) {
    return ip;
  }

  if (!net.ips.reserved[ip].hasOwnProperty('belongs_to_uuid')) {
    return ip;
  }

  return new restify.InvalidArgumentError(
      'IP address "%s" is already taken', addr);
}



/*
 * Returns the basic serialized form of the IP
 */
function serializeIP(app, num, netUUID) {
  var network = app.data.networks[netUUID];
  var ip = network.ips.reserved[num];
  var serialized = {
    ip: util_ip.numberToAddress(num),
    netmask: util_ip.numberToAddress(network.netmask)
  };

  if (network.gateway) {
    serialized.gateway = util_ip.numberToAddress(network.gateway);
  }

  if (ip) {
    var keys = ['owner_uuid', 'belongs_to_uuid', 'belongs_to_type', 'reserved'];

    for (var k in keys) {
      var key = keys[k];
      if (ip.hasOwnProperty(key)) {
        serialized[key] = ip[key];
      }
    }

    if (ip.nic && app.data.nics.hasOwnProperty(ip.nic)) {
      serialized.nic = util_mac.macNumberToAddress(ip.nic);
    }
  }

  return serialized;
}


/*
 * Returns serialized form of the IP, with network parameters
 */
function serializeIPWithNetwork(app, num, netUUID) {
  var serialized = serializeIP(app, num, netUUID);
  var net = app.data.networks[netUUID];
  serialized.vlan_id = net.vlan;
  serialized.nic_tag = net.name; // XXX

  serialized.resolvers = [];
  for (var r in net.resolvers) {
    serialized.resolvers.push(util_ip.numberToAddress(net.resolvers[r]));
  }
  return serialized;
}



// --- IP object


/*
 * IP object constructor
 */
function IP(app, params) {
  this.app = app;
  this.network = app.data.networks[this.netUUID];
  this.netUUID = params.network;
  this.ipNum = params.number;

  if (params.nic) {
    this.nic = params.nic;
  }

  this.params = {
    owner_uuid: params.owner_uuid,
    belongs_to_uuid: params.belongs_to_uuid,
    belongs_to_type: params.belongs_to_type,
    reserved: params.reserved
  };
}


/*
 * Returns the serialized form of the IP, suitable for public consumption
 */
IP.prototype.serialize = function () {
  return serializeIP(this.app, this.ipNum, this.netUUID);
};


/*
 * Returns the serialized form of the IP, suitable for public consumption
 */
IP.prototype.serializeWithNetwork = function () {
  return serializeIPWithNetwork(this.app, this.ipNum, this.netUUID);
};


/*
 * Returns the data store representation of the IP
 */
IP.prototype.raw = function () {
  var data = {
    owner_uuid: this.params.owner_uuid,
    belongs_to_uuid: this.params.belongs_to_uuid,
    belongs_to_type: this.params.belongs_to_type,
    reserved: this.params.reserved
  };

  if (this.nic) {
    data.nic = this.nic;
  }

  return data;
};


/*
 * Updates the datastore with the IP's data
 */
IP.prototype.updateDataStore = function (app, callback) {
  var data = this.raw();
  app.data.networks[this.netUUID].ips.reserved[this.ipNum] = data;

  if (!callback) {
    return null;
  }

  app.writeDataFile(function (err) {
    if (err) {
      // XXX: bubble up a nicer error
      return callback(err);
    }

    return callback(null);
  });
  return null;
};


/*
 * Deletes the IP's data from the data store
 */
IP.prototype.deleteFromDataStore = function (app, callback) {
  if (this.params.reserved) {
    // If reserved, we don't actually delete - just remove the association
    // between nic and IP, and remove belongs_to
    var data = this.raw();
    delete data.nic;
    delete data.belongs_to_uuid;
    delete data.belongs_to_type;
    app.data.networks[this.netUUID].ips.reserved[this.ipNum] = data;
  } else {
    delete app.data.networks[this.netUUID].ips.reserved[this.ipNum];
  }

  if (!callback) {
    return null;
  }

  app.writeDataFile(function (err) {
    if (err) {
      // XXX: bubble up a nicer error
      return callback(err);
    }

    return callback(null);
  });
  return null;
};


/*
 * Gets the numeric representation of the IP address
 */
IP.prototype.number = function () {
  return this.ipNum;
};



// --- Exported functions



/*
 * List IPs in a network
 */
function listNetworkIPs(app, params, log) {
  var uuid = params.network_uuid;
  var ips = [];

  for (var ipNum in app.data.networks[uuid].ips.reserved) {
    ips.push(serializeIP(app, ipNum, uuid));
  }

  return ips;
}


/*
 * Get an IP
 */
function getIP(app, netUUID, ipNum) {
  var network = app.data.networks[netUUID];
  var ipData = network.ips.reserved[ipNum];

  // If the IP is not in the reserved list, but is still within the subnet,
  // create it. This allows for doing a GET on IPs not in the data store
  // so that they appear as unreserved.
  if (!ipData) {
    return createIP(app, { number: ipNum, network: netUUID });
  }

  // Massage the raw data a bit for the constructor
  ipData.network = netUUID;
  ipData.number = ipNum;

  return new IP(app, ipData);
}


/*
 * Update an IP
 */
function updateIP(app, netUUID, ipNum, params, callback) {
  var ip = getIP(app, netUUID, ipNum);
  if (ip instanceof Error) {
    return callback(ip);
  }

  if (params.hasOwnProperty('reserved') &&
      (params.reserved == 'true' || params.reserved == 'false')) {
    ip.params.reserved = params.reserved;
  }

  ip.updateDataStore(app, function (err) {
    if (err) {
      return callback(err);
    }
    return callback(null, ip);
  });
  return null;
}


/*
 * Create an IP
 */
function createIP(app, params) {
  var netUUID = params.network;
  var addr = params.address;

  if (!params.number) {
    if (addr) {
      params.number = findFreeIPbyAddress(app, netUUID, addr);
    } else {
      params.number = findNextFreeIP(app, netUUID);
    }
  }

  if (params.number instanceof Error) {
    return params.number;
  }

  return new IP(app, params);
}



module.exports = {
  createIP: createIP,
  getIP: getIP,
  listNetworkIPs: listNetworkIPs,
  updateIP: updateIP
};
