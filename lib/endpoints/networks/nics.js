/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/nics endpoints
 */

var mod_nic = require('../../models/nic');



// --- Endpoints



/*
 * POST /networks/:network_uuid/nics: create a nic on a logical network
 */
function createNetworkNic(app, log, req, res, next) {
  mod_nic.provisionNic(app, log, req.params, function(err, nic) {
    if (err) {
      return next(err);
    }
    res.send(200, nic);
    return next();
  });
}


/*
 * Register all endpoints with the restify server
 */
function register(http, app, log) {
  http.post(
    { path: '/networks/:network_uuid/nics', name: 'createNetworkNic' },
    function(req, res, next) {
      return createNetworkNic(app, log, req, res, next);
    }
  );
}



module.exports = {
  register: register
};
