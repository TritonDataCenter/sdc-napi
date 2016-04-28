/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI /networks/:network_uuid/ips endpoints
 */

'use strict';

var mod_common = require('./common');
var mod_ip = require('../../models/ip');
var restify = require('restify');
var util_ip = require('../../util/ip');



// --- Helper functions



/**
 * Validate IP before calling ips/:ip_addr endpoints
 */
function validateIP(req, res, next) {
    var ip = util_ip.toIPAddr(req.params.ip_addr);
    if (!ip) {
        return next(new restify.ResourceNotFoundError(
            'Invalid IP address'));
    }

    if (!ip.match(req._network.subnetStart, req._network.subnetBits)) {
        return next(new restify.ResourceNotFoundError(
            'IP is not in subnet'));

    }

    req.params.ip = ip;

    return next();
}



// --- Endpoints



/**
 * GET /networks/:network_uuid/ips: list all IPs in a logical network
 */
function listIPs(req, res, next) {
    req.params.network = req._network;
    mod_ip.list(req.app, req.log, req.params, function (err, ips) {
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var t in ips) {
            serialized.push(ips[t].serialize());
        }

        res.send(200, serialized);
        return next();
    });
}


/**
 * GET /networks/:network_uuid/ips/:ip_addr: get IP
 */
function getIP(req, res, next) {
    req.params.network = req._network;

    var getOpts = {
        app: req.app,
        log: req.log,
        params: req.params,
        // If the IP doesn't exist in moray, return a record anyway, so that
        // consumers know it's available:
        returnObject: true
    };

    mod_ip.get(getOpts, function (err, ip) {
        if (err) {
            return next(err);
        }

        res.send(200, ip.serialize());
        return next();
    });
}


/**
 * PUT /networks/:network_uuid/ips/:ip_addr: update IP
 */
function putIP(req, res, next) {
    // the mod_ip.* functions require a network model object:
    req.params.network = req._network;

    if (req.params.hasOwnProperty('free') && req.params.free) {
        return mod_ip.del(req.app, req.log, req.params, function (err) {
            if (err && err.statusCode !== 404) {
                return next(err);
            }

            res.send(200, {
                ip: req.params.ip_addr,
                network_uuid: req.params.network_uuid,
                reserved: false,
                free: true
            });
            return next();
        });
    }

    // The API pretends that IPs exist when they don't actually exist in UFDS,
    // so that consumers can do a GET on an IP to find out if it's in use.
    // Doing a GET here first serves two purposes:
    // 1) Determines whether we should do a create or an update in moray
    // 2) For an update, the existing record is needed to ensure that all of
    //    belongs_to_uuid, owner_uuid and belongs_to_type will be set

    mod_ip.get({ app: req.app, log: req.log, params: req.params },
        function (err, ip) {
        if (err || !ip) {
            if (err && err.statusCode !== 404) {
                return next(err);
            }

            // Not found in moray, so do a create
            return mod_ip.create(req.app, req.log, req.params,
                function (err2, ip2) {
                if (err2) {
                    return next(err2);
                }

                res.send(200, ip2.serialize());
                return next();
            });
        }

        // IP found in moray, so do an update
        req.params.oldIP = ip.serialize();
        mod_ip.update(req.app, req.log, req.params, function (err2, ip2) {
            if (err2) {
                return next(err2);
            }

            res.send(200, ip2.serialize());
            return next();
        });
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    var beforeAll = before.concat([
        mod_common.ensureNetworkExists.bind(null, 'network_uuid')
    ]);
    var beforeIP = beforeAll.concat(validateIP);

    http.get(
        { path: '/networks/:network_uuid/ips', name: 'ListIPs' },
        beforeAll, listIPs);
    http.head(
        { path: '/networks/:network_uuid/ips', name: 'HeadIPs' },
        beforeAll, listIPs);
    http.get(
        { path: '/networks/:network_uuid/ips/:ip_addr', name: 'GetIP' },
        beforeIP, getIP);
    http.put(
        { path: '/networks/:network_uuid/ips/:ip_addr', name: 'UpdateIP' },
        beforeIP, putIP);
}



module.exports = {
    register: register
};
