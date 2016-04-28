/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * NAPI /networks/:network_uuid/nics endpoints
 */

'use strict';

var mod_nic = require('../../models/nic');
var reqToOpts = require('../../util/common').reqToOpts;



// --- Endpoints



/**
 * POST /networks/:network_uuid/nics: create a nic on a logical network
 */
function postNetworkNic(req, res, next) {
    mod_nic.create(reqToOpts(req),
        function (err, nic) {
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
