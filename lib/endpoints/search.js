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

var assert = require('assert-plus');
var constants = require('../util/constants');
var mod_err = require('../util/errors');
var mod_ip = require('../models/ip');
var mod_net = require('../models/network');
var restify = require('restify');
var util_ip = require('../util/ip');
var validate = require('../util/validate');
var vasync = require('vasync');

/**
 * Filter our arguments into a set which are used to list networks and others.
 */
var sip_list_args = {
    'fabric': true
};

function searchIPsFilterArgs(params, list_args, ip_args)
{
    var key;

    assert.object(params, 'params');
    assert.object(list_args, 'list_args');
    assert.object(ip_args, 'ip_args');

    for (key in params) {
        if (sip_list_args[key] === true) {
            list_args[key] = params[key];
        } else {
            ip_args[key] = params[key];
        }
    }
}

// --- Endpoints



/**
 * GET /search/ips: search for an IP address across all logical networks
 */
function searchIPs(req, res, next) {

    validate.params({
        params: req.params,
        strict: true,
        required: {
            ip: validate.IP
        },
        optional: {
            belongs_to_type: validate.string,
            belongs_to_uuid: validate.UUID,
            fabric: validate.bool,
            owner_uuid: validate.UUID
        }
    }, function (valerr, params) {
        var ipNum;
        var iargs = {};
        var largs = {};

        if (valerr) {
            return next(valerr);
        }

        ipNum = params.ip;
        searchIPsFilterArgs(params, largs, iargs);

        mod_net.list({ app: req.app, log: req.log, params: largs },
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
                    // ensures that we will get an object back even if there's
                    // no record in moray
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
                        var sip, prop;
                        if (err2 || !ip) {
                            return cb(err2);
                        }

                        sip = ip.serialize();
                        for (prop in iargs) {
                            if (!sip.hasOwnProperty(prop)) {
                                return cb();
                            }

                            if (iargs.prop !== sip.prop) {
                                return cb();
                            }
                        }
                        results.push(sip);

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
