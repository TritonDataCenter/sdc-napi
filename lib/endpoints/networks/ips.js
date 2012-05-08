/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/ips endpoints
 */

// --- Endpoints



/*
 * /networks/:network_uuid/ips: list all logical networks
 */
function listIPs(req, res, next) {
  var networks = req.app.data.networks;
  var uuid = req.params.network_uuid;

  if (!networks.hasOwnProperty(uuid) ||
      !networks[uuid].hasOwnProperty('ips')) {
    res.send(404);
    return next();
  }

  res.send(200, networks[uuid].ips);
  return next();
}


/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.get(
    { path: '/networks/:network_uuid/ips', name: 'ListIPs' },
    before, listIPs);
}



module.exports = {
  register: register
};
