/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks endpoints
 */

var mod_net = require('../models/network.js');


// --- Endpoints



/*
 * /networks: list all logical networks
 */
function listNetworks(req, res, next) {
  res.send(200, mod_net.listNetworks(req.app, req.params, ['name'], req.log));
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
