/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/nics endpoints
 */

var mod_nic = require('../../models/nic');



// --- Endpoints



/**
 * POST /networks/:network_uuid/nics: create a nic on a logical network
 */
function postNetworkNic(req, res, next) {
  mod_nic.create(req.app, req.log, req.params, function (err, nic) {
    if (err) {
      return next(err);
    }
    res.send(200, nic.serialize());
    return next();
  });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.post(
    { path: '/networks/:network_uuid/nics', name: 'ProvisionNic' },
    before, postNetworkNic);
}



module.exports = {
  register: register
};
