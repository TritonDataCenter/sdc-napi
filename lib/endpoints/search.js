/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI /search endpoints
 */

var constants = require('../util/constants');
var mod_err = require('../util/errors');
var mod_ip = require('../models/ip');
var mod_net = require('../models/network');
var restify = require('restify');
var util_ip = require('../util/ip');
var vasync = require('vasync');



// --- Endpoints



/**
 * GET /search/ips: search for an IP address across all logical networks
 */
function searchIPs(req, res, next) {
    var ipNum = util_ip.addressToNumber(req.params.ip);
    if (!ipNum) {
        return next(new mod_err.InvalidParamsError(
            mod_err.INVALID_MSG,
            [ mod_err.invalidParam('ip', constants.INVALID_IP_MSG) ]));
    }

    // list networks
    // - filter out ones where IP isn't in range
    // list ips
    mod_net.list(req.app, req.log, req.params, function (err, nets) {
        if (err) {
            return next(err);
        }

        var filtered = nets.filter(function (net) {
            if (net.minIP <= ipNum && ipNum <= net.maxIP) {
                return true;
            }

            return false;
        });

        if (filtered.length === 0) {
            return next(new restify.ResourceNotFoundError(
                'No networks found containing that IP address'));
        }

        var results = [];

        vasync.forEachParallel({
            inputs: filtered,
            func: function _listIPs(net, cb) {
                var params = {
                    ip: ipNum,
                    network_uuid: net.uuid,
                    returnObject: true
                };

                // Use get rather than list here: returnObject in the params
                // ensures that we will get an object back even if there's no
                // record in moray
                mod_ip.get(req.app, req.log, params, function (err2, ip) {
                    if (err2 || !ip) {
                        return cb(err2);
                    }

                    results.push(ip.serialize());

                    return cb();
                });
            }
        }, function (resErr) {
            if (resErr) {
                return next(resErr);
            }

            res.send(200, results);
            return next();
        });
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    // XXX: validate IP before
    http.get(
        { path: '/search/ips', name: 'searchIPs' },
        before, searchIPs);
}



module.exports = {
    register: register
};
