/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Common functions shared between networks endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_net = require('../../models/network');
var mod_restify = require('restify');
var reqToOpts = require('../../util/common').reqToOpts;



// --- Globals

var USE_FULL_GET_SCHEMA = {
    'getnetwork': true,
    'headnetwork': true,
    'deletenetwork': true
};

// --- Exports



/**
 * Ensures the network exists, returning 404 if it does not. If it exists,
 * the network is stored in req.params._network so it can be used for
 * further validation.
 *
 * If this is a USE_FULL_GET_SCHEMA request, then we want to make sure
 * we pass through everything to the GET_SCHEMA so that we perform
 * ownership checks.
 */
function ensureNetworkExists(netKey, req, res, next) {
    var opts;

    if (USE_FULL_GET_SCHEMA[req.route.name]) {
        assert.equal(netKey, 'uuid');
        opts = reqToOpts(req);
    } else {
        opts = {
            app: req.app,
            log: req.log,
            params: {
                uuid: req.params[netKey]
            }
        };
    }

    mod_net.get(opts, function (err, net) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                next(new mod_restify.ResourceNotFoundError(err,
                    'network not found'));
                return;
            }
            next(err);
            return;
        }

        /*
         * We copy the actual UUID over the original value, in case it was one
         * of the allowed symbolic names, like "admin".
         */
        req.params[netKey] = net.uuid;
        req.params.network = net;
        req._network = net;
        res.etag = net.etag;

        next();
    });
}



module.exports = {
    ensureNetworkExists: ensureNetworkExists
};
