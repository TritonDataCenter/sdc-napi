/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/ips endpoints
 */

var mod_ip = require('../../models/ip');
var mod_net = require('../../models/network');
var restify = require('restify');
var util_ip = require('../../util/ip');



// --- Helper functions



/**
 * Validate IP before calling ips/:ip_addr endpoints
 */
function validateIP(req, res, next) {
    var num = util_ip.addressToNumber(req.params.ip_addr);
    if (!num) {
        return next(new restify.ResourceNotFoundError(
            'Invalid IP address'));
    }

    if (num > req._network.maxIP || num < req._network.minIP) {
        return next(new restify.ResourceNotFoundError(
            'IP is not in subnet'));
    }

    req.params.ip = num;

    return next();
}


/**
 * Ensures the network exists, returning 404 if it does not. If it exists,
 * the network is stored in req._network so it can be used for further
 * validation.
 */
function ensureNetworkExists(req, res, next) {
    mod_net.get(req.app, req.log, { uuid: req.params.network_uuid },
        function (err, net) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                return next(new restify.ResourceNotFoundError(err,
                    'network not found'));
            }
            return next(err);
        }

        req._network = net;
        return next();
    });
}



// --- Endpoints



/**
 * GET /networks/:network_uuid/ips: list all IPs in a logical network
 */
function listIPs(req, res, next) {
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
    // If the IP doesn't exist in moray, return a record anyway, so that
    // consumers know it's available
    req.params.returnObject = true;

    mod_ip.get(req.app, req.log, req.params, function (err, ip) {
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
    if (req.params.hasOwnProperty('free') && req.params.free) {
        return mod_ip.del(req.app, req.log, req.params, function (err) {
            if (err && err.statusCode != 404) {
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

    // the mod_ip.* functions require a network model object:
    req.params.network = req._network;

    // The API pretends that IPs exist when they don't actually exist in UFDS,
    // so that consumers can do a GET on an IP to find out if it's in use.
    // Doing a GET here first serves two purposes:
    // 1) Determines whether we should do a create or an update in moray
    // 2) For an update, the existing record is needed to ensure that all of
    //    belongs_to_uuid, owner_uuid and belongs_to_type will be set

    delete req.params.returnObject;
    mod_ip.get(req.app, req.log, req.params, function (err, ip) {
        if (err || !ip) {
            if (err && err.statusCode != 404) {
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
    var beforeAll = before.concat([ensureNetworkExists]);
    var beforeIP = beforeAll.concat(validateIP);

    http.get(
        { path: '/networks/:network_uuid/ips', name: 'ListIPs' },
        before, listIPs);
    http.head(
        { path: '/networks/:network_uuid/ips', name: 'HeadIPs' },
        before, listIPs);
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
