/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /networks/:network_uuid/ips endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_common = require('./common');
var mod_ip = require('../../models/ip');
var reqToOpts = require('../../util/common').reqToOpts;
var restify = require('restify');
var util_ip = require('../../util/ip');
var mod_jsprim = require('jsprim');



// --- Helper functions


/*
 * The API pretends that IPs exist when they don't actually exist in Moray,
 * so that consumers can do a GET on an IP to find out if it's in use.
 * Doing a get({ returnObject: true }) here first serves several purposes:
 *
 * 1) Allows us to determine whether we should do a create or an update in
 *    Moray in UpdateIP.
 * 2) For an update, the existing record is needed to ensure that all of
 *    belongs_to_uuid, owner_uuid and belongs_to_type will be set.
 * 3) Sets the etag so that HTTP consumers can set If-Match headers.
 *
 * We store the IP object in req._ip for the handlers that come later in
 * the chain.
 */
function ensureIpExists(req, res, next) {
    assert.object(req._network, 'req._network');

    req.params.network = req._network;

    mod_ip.get({
        app: req.app,
        log: req.log,
        params: req.params,
        returnObject: true
    }, function (err, ip) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                next(new restify.ResourceNotFoundError(err,
                    'network not found'));
                return;
            }

            next(err);
            return;
        }

        if (!filterRange(ip)) {
            next(new restify.ResourceNotFoundError(
                'IP address not within network range'));
        }

        req._ip = ip;
        res.etag = ip.etag;

        next();
    });
}

/**
 * Validate IP before calling ips/:ip_addr endpoints
 */
function validateIP(req, res, next) {
    var ip = util_ip.toIPAddr(req.params.ip_addr);
    if (!ip) {
        return next(new restify.ResourceNotFoundError(
            'Invalid IP address'));
    }

    if (ip.kind() !== req._network.family) {
        return next(new restify.ResourceNotFoundError(
            'IP and subnet are of different address families'));
    }

    if (!req._network.subnet.contains(ip)) {
        return next(new restify.ResourceNotFoundError(
            'IP is not in subnet'));
    }

    req.params.ip = ip;

    return next();
}

/**
 *  Honor Network Provisionable Range
 */
function filterRange(ip) {
    assert.object(ip, "ip")
    
    // We should show managed addresses
    if (ip.params != null && ip.params.belongs_to_type === "other") {
        return true;
    }

    var Addr
    if (ip.params.ipaddr != null) {
        Addr = util_ip.addressToNumber(ip.params.ipaddr);
    } 
    if (ip.params.ip != null) {
        Addr = util_ip.addressToNumber(ip.params.ip.toString());
    } 
    var maxAddr = util_ip.addressToNumber(ip.params.network.provisionMax.toString());
    var minAddr = util_ip.addressToNumber(ip.params.network.provisionMin.toString());
    if (Addr >= minAddr && Addr <= maxAddr) {
        return true;
    }

    return false;
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
	    if (filterRange(ips[t])) {
            	serialized.push(ips[t].serialize());
	    }
        }

        res.send(200, serialized);
        return next();
    });
}


/**
 * GET /networks/:network_uuid/ips/:ip_addr: get IP
 */
function getIP(req, res, next) {
    assert.object(req._ip, 'req._ip');
    if (req._ip.etag !== null) {
        res.header('Etag', req._ip.etag);
    }

    res.send(200, req._ip.serialize());
    next();
}


/**
 * PUT /networks/:network_uuid/ips/:ip_addr: update IP
 */
function putIP(req, res, next) {
    assert.object(req._network, 'req._network');
    assert.object(req._ip, 'req._ip');

    var opts = reqToOpts(req, {
        existingIP: req._ip
    });

    // the mod_ip.* functions require a network model object:
    opts.params.network = req._network;

    function sendResponse(err, ip) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', ip.etag);
        res.send(200, ip.serialize());

        next();
    }

    if (mod_jsprim.hasKey(req.params, 'free') && req.params.free &&
        !mod_jsprim.hasKey(req.params, 'unassign')) {
        mod_ip.del(opts, sendResponse);
        return;
    }

    if (opts.existingIP.etag === null) {
        // Not found in Moray, so do a create
        mod_ip.create(opts, sendResponse);
    } else {
        // IP found in moray, so do an update
        req.params.oldIP = opts.existingIP.serialize();
        mod_ip.update(opts, sendResponse);
    }
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    var beforeAll = before.concat([
        mod_common.ensureNetworkExists.bind(null, 'network_uuid')
    ]);
    var ipRequired = beforeAll.concat([
        validateIP,
        ensureIpExists,
        restify.conditionalRequest()
    ]);

    http.get({ path: '/networks/:network_uuid/ips', name: 'listips' },
        beforeAll, listIPs);
    http.head({ path: '/networks/:network_uuid/ips', name: 'headips' },
        beforeAll, listIPs);

    http.get({ path: '/networks/:network_uuid/ips/:ip_addr', name: 'getip' },
        ipRequired, getIP);
    http.put({ path: '/networks/:network_uuid/ips/:ip_addr', name: 'updateip' },
        ipRequired, putIP);
}



module.exports = {
    register: register
};
