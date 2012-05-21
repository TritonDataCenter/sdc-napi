/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks endpoints
 */

var IP = require('../util/ip');



// --- Internal helpers



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



// --- Endpoints



/*
 * /networks: list all logical networks
 */
function listNetworks(req, res, next) {
  var networks = [];
  var app = req.app
  for (var n in app.data.networks) {
    networks.push(serializeNetwork(n, app.data.networks[n]));
  }
  res.send(200, networks);
  return next();
}


/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.get(
    { path: '/networks', name: 'ListNetworks' }, before, listNetworks);
  http.head(
    { path: '/networks', name: 'headNetworks' }, before, listNetworks);
}



module.exports = {
  register: register
};
