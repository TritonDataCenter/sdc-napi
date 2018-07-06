/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /ping endpoint
 */

'use strict';

var constants = require('../util/constants');



// --- Endpoints



/**
 * /ping: return service status
 */
function ping(req, res, next) {
    var stats = {
        config: {
            fabrics_enabled: constants.FABRICS_ENABLED,
            subnet_alloc_enabled: req.app.config.autoAllocSubnets
        },
        healthy: true,
        services: {
            moray: 'online'
        },
        status: 'OK'
    };

    if (req.app.isInState('init')) {
        if (req.app.isInState('init.moray')) {
            stats.services.moray = 'offline';
        }
        stats.status = 'initializing';
        stats.healthy = false;
    }

    res.send(200, stats);
    next();
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    // We don't want to return 503 if moray is down: ping should always
    // report the status regardless
    var filtered = before.filter(function (f) {
        return (f.name !== 'checkServices');
    });

    http.get(
        { path: '/ping', name: 'getping' }, filtered, ping);
    http.head(
        { path: '/ping', name: 'headping' }, filtered, ping);
}



module.exports = {
    register: register
};
