/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Handles loading all restify endpoints for NAPI
 */

'use strict';

/*
 * Endpoints are in their own individual files, in a directory structure
 * that roughly matches their routes, eg:
 *   /networks -> networks.js
 *   /networks/:network_uuid/ips -> networks/ips.js
 */
var toRegister = {
    '/aggregations': require('./aggregations'),
    '/fabrics/:owner_uuid/vlans': require('./fabrics/vlans'),
    '/fabrics/:owner_uuid/vlans/networks': require('./fabrics/networks'),
    '/networks': require('./networks'),
    '/networks/:network_uuid/ips': require('./networks/ips'),
    '/networks/:network_uuid/nics': require('./networks/nics'),
    '/network_pools': require('./network-pools'),
    '/nics': require('./nics'),
    '/nic_tags': require('./nic-tags'),
    '/ping': require('./ping'),
    '/search': require('./search')
};



// --- Exports



/*
 * Register all endpoints with the restify server
 */
function registerEndpoints(http, log, before) {
    for (var t in toRegister) {
        log.debug('Registering endpoints for "%s"', t);
        toRegister[t].register(http, before);
    }
}



module.exports = {
    registerEndpoints: registerEndpoints
};
