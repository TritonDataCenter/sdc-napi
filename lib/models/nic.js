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
function findNextFreeIP(net) {
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
 * Creates a new Nic, reserving a new IP and MAC in the process 
 */
function createNic(app, net, params) {
  var ip = findNextFreeIP(net);
  if (ip instanceof Error) {
    return ip;
  }

  if (params.hasOwnProperty('mac')) {
    mac = mod_mac.macAddressToNumber(params.mac);
    if (!mac) {
      return new restify.InvalidArgumentError("Invalid MAC address '%s'",
          params.mac);
    }
    if (app.data.nics.hasOwnProperty(mac)) {
      return new restify.InvalidArgumentError(
          "MAC address '%s' already exists", params.mac);
    }
  } else {
    mac = findNextFreeMAC(app.data.nics, app.config.macOUI);
    if (mac instanceof Error) {
      return mac;
    }
  }

  var newNic = new Nic(app, net, ip, mac, params);
  net.ips.reserved[ip] = {
    nic: mac,
    owner_uuid: params.owner_uuid,
    belongs_to_uuid: params.belongs_to_uuid,
    belongs_to_type: params.belongs_to_type
  };
  app.data.nics[mac] = {
    ip: ip,
    owner_uuid: params.owner_uuid,
    belongs_to_uuid: params.belongs_to_uuid,
    belongs_to_type: params.belongs_to_type
  };

  return newNic;
}


/*
 * Constructor for the Nic model
 */
function Nic(app, net, ip, mac, params) {
  this.app = app;
  this.network = net;
  this.ip = ip;
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
    ip: mod_ip.numberToAddress(this.ip),
    netmask: mod_ip.numberToAddress(net.netmask),
    vlan_id: net.vlan,
    // XXX: should we keep track of nic?
    nic_tag: net.name, // XXX
    mac: mod_mac.macNumberToAddress(this.mac),
    primary: this.primary
  };

  if (net.gateway) {
    serialized.gateway = mod_ip.numberToAddress(net.gateway);  
  }

  serialized.resolvers = [];
  for (var r in net.resolvers) {
    serialized.resolvers.push(mod_ip.numberToAddress(net.resolvers[r]));
  }

  return serialized;
}



// --- Exported functions



/*
 * Provisions a new nic
 */
function provisionNic(app, log, params, callback) {
  var networks = app.data.networks;
  var uuid = params.network_uuid;

  // TODO: enforce only one nic for a zone being the primary

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


  var nic = createNic(app, net, params);
  if (nic instanceof Error) {
    return callback(nic);
  }

  app.writeDataFile(function(err) {
    if (err) {
      // XXX: bubble up a nicer error
      return callback(err);
    }

    return callback(null, nic.serialize());
  });
}


module.exports = {
  provisionNic: provisionNic
};
