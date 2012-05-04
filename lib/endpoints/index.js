/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Handles loading all restify endpoints for NAPI
 */

/*
 * Endpoints are in their own individual files, in a directory structure
 * that roughly matches their routes, eg:
 *   /networks -> networks.js
 *   /networks/:network_uuid/ips -> networks/ips.js
 */
var toRegister = {
  '/networks': require('./networks'),
  '/networks/:network_uuid/ips': require('./networks/ips'),
  '/networks/:network_uuid/nics': require('./networks/nics')
};



/*
 * Register all endpoints with the restify server
 */
function registerEndpoints(http, app, log) {
  for (var t in toRegister) {
    log.debug("Registering endpoints for '%s'", t);
    toRegister[t].register(http, app, log);
  }
}



module.exports = {
  registerEndpoints: registerEndpoints
};
