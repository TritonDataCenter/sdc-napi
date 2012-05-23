/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * network model and related functions
 */

var IP = require('../util/ip');
var mod_ip = require('../util/ip');



// --- Internal helpers



/*
 * Returns true if the networks matches all of the criteria specified by
 * params (currently only name)
 */
function matchNetwork(network, params, required, log) {
  for (var r in required) {
    var req = required[r];
    if (!params.hasOwnProperty(req)) {
      continue;
    }
    var param = params[req];
    var actualParam = network[req];
    var actualPretty = network[req];

    // Convert IP params to numeric representation
    if (req == 'network' || req == 'netmask' || req == 'start_ip'
        || req == 'end_ip' || req == 'gateway') {
      param = mod_ip.addressToNumber(param);
      actualPretty = mod_ip.numberToAddress(actualParam);
    }

    // TODO: make nic tags a real thing
    if (req == 'nic_tag') {
      actualParam = network.name;
      actualPretty = network.name;
    }

    if (req == 'vlan_id') {
      actualParam = network.vlan;
      actualPretty = network.vlan;
    }

    if (param != actualParam) {
      log.debug("matchNetwork: '%s' match failed: wanted='%s' (%s), " +
          "actual='%s' (%s)",
          req, params[req], param, actualPretty, actualParam);
      return false;
    }
  }
  return true;
}


/*
 * Returns the serialized form of the network
 */
function serializeNetwork(uuid, data) {
  var network = {
    uuid: uuid,
    name: data.name,
    vlan: data.vlan,
    // TODO: use CIDR notation here
    network: IP.numberToAddress(data.network),
    netmask: IP.numberToAddress(data.netmask),
    start_ip: IP.numberToAddress(data.startIP),
    end_ip: IP.numberToAddress(data.endIP),
  };

  var resolvers = [];
  for (var r in data.resolvers) {
    resolvers.push(IP.numberToAddress(data.resolvers[r]));
  }
  network.resolvers = resolvers;

  if (data.gateway) {
    network.gateway = IP.numberToAddress(data.gateway);
  }

  return network;
}



// --- Exported functions 


/*
 * Returns a list of network UUIDs matching the required parameters
 */
function listNetworkUUIDs(app, params, required, log) {
  var uuids = [];
  for (var n in app.data.networks) {
    var network = app.data.networks[n];
    if (matchNetwork(network, params, required, log)) {
      uuids.push(n);
    }
  }
  return uuids;
}


/*
 * Lists networks, filtering by parameters
 */
function listNetworks(app, params, required, log) {
  var uuids = listNetworkUUIDs(app, params, required, log);
  return uuids.map(function(n) {
    return serializeNetwork(n, app.data.networks[n]);
  });
}


  listNetworkUUIDs: listNetworkUUIDs

module.exports = {
  listNetworks: listNetworks,
  listNetworkUUIDs: listNetworkUUIDs
};
