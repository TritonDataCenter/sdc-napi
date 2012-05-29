/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * IP model
 */


var mod_ip = require('../util/ip');
var mod_mac = require('../util/mac');



// --- Internal helpers


/*
 * Returns the serialized form of the IP, suitable for public consumption
 */
function serializeIP(app, num, netUUID) {
  var network = app.data.networks[netUUID];
  var ip = network.ips.reserved[num];
  var serialized = {
    ip: mod_ip.numberToAddress(num),
    owner_uuid: ip.owner_uuid,
    belongs_to_uuid: ip.belongs_to_uuid,
    belongs_to_type: ip.belongs_to_type,
    netmask: mod_ip.numberToAddress(network.netmask)
  };

  if (network.gateway) {
    serialized.gateway = mod_ip.numberToAddress(network.gateway);
  }

  if (ip.nic && app.data.nics.hasOwnProperty(ip.nic)) {
    serialized.nic = mod_mac.macNumberToAddress(ip.nic);
  }

  return serialized;
}

// --- Exported functions



/*
 * List IPs in a network
 */
function listNetworkIPs(app, params, log) {
  var networks = app.data.networks;
  var uuid = params.network_uuid;
  var ips = [];

  for (var ip in app.data.networks[uuid].ips.reserved) {
    ips.push(serializeIP(app, ip, uuid));
  }

  return ips;
}


/*
 * Get an IP
 */
function getIP(app, netUUID, number, log) {
  var ip = app.data.networks[netUUID].ips.reserved[number];
  if (!ip) {
    return;
  }

  return serializeIP(app, number, netUUID);
}



module.exports = {
  listNetworkIPs: listNetworkIPs,
  getIP: getIP
};
