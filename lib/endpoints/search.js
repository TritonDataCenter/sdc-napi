/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
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
    var ipNum = util_ip.toIPAddr(req.params.ip);
    if (!ipNum) {
        return next(new mod_err.InvalidParamsError(
            constants.msg.INVALID_PARAMS,
            [ mod_err.invalidParam('ip', constants.INVALID_IP_MSG) ]));
    }

    mod_net.list({ app: req.app, log: req.log, params: req.params },
            function (err, nets) {
        if (err) {
            return next(err);
        }

        var filtered = nets.filter(function (net) {
            return ipNum.match(net.subnetStart, net.subnetBits);
        });

        if (filtered.length === 0) {
            return next(new restify.ResourceNotFoundError(
                constants.msg.SEARCH_NO_NETS));
        }

        var results = [];

        vasync.forEachParallel({
            inputs: filtered,
            func: function _listIPs(net, cb) {
                // Use get rather than list here: returnObject in the params
                // ensures that we will get an object back even if there's no
                // record in moray
                var getOpts = {
                    app: req.app,
                    log: req.log,
                    params: {
                        ip: ipNum,
                        network: net,
                        network_uuid: net.uuid
                    },
                    returnObject: true
                };

                mod_ip.get(getOpts, function (err2, ip) {
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
