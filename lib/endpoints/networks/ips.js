/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/ips endpoints
 */

// --- Endpoints



/*
 * /networks/:network_uuid/ips: list all logical networks
 */
function listIPs(app, log, req, res, next) {
  var networks = app.data.networks;
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
function register(http, app, log) {
  http.get(
    { path: '/networks/:network_uuid/ips', name: 'ListIPs' },
    function(req, res, next) {
      return listIPs(app, log, req, res, next);
    }
  );
}



module.exports = {
  register: register
};
