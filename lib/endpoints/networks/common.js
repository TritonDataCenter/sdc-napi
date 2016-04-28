/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Common functions shared between networks endpoints
 */

'use strict';

var mod_net = require('../../models/network');
var mod_restify = require('restify');



// --- Exports



/**
 * Ensures the network exists, returning 404 if it does not. If it exists,
 * the network is stored in req.params._network so it can be used for
 * further validation.
 */
function ensureNetworkExists(netKey, req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: { uuid: req.params[netKey] }
    };

    mod_net.get(opts, function (err, net) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                return next(new mod_restify.ResourceNotFoundError(err,
                    'network not found'));
            }
            return next(err);
        }

        req.params.network = net;
        req._network = net;
        return next();
    });
}



module.exports = {
    ensureNetworkExists: ensureNetworkExists
};
