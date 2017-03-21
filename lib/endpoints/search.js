/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * NAPI /search endpoints
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var mod_ip = require('../models/ip');
var mod_net = require('../models/network');
var mod_stream = require('stream');
var mod_util = require('util');
var restify = require('restify');
var validate = require('../util/validate');


// --- Schema validation objects

var SEARCH_SCHEMA = {
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
};

/**
 * Filter our arguments into a set which are used to list networks and others.
 */
var SIP_LIST_ARGS = {
    'fabric': true
};

function searchIPsFilterArgs(params) {
    var key;
    var list_args = {};
    var ip_args = {};

    assert.object(params, 'params');
    assert.object(list_args, 'list_args');
    assert.object(ip_args, 'ip_args');

    for (key in params) {
        if (!params.hasOwnProperty(key)) {
            continue;
        }

        /*
         * We skip "ip" since we only ever fetch matching IPs from Moray.
         * Additionally, beyond being superfluous, the saved IP in the stream
         * (sipn_ip) is an object, while the passed in value will be a string,
         * so the comparison will fail.
         */
        if (key === 'ip') {
            continue;
        }

        if (SIP_LIST_ARGS[key] === true) {
            list_args[key] = params[key];
        } else {
            ip_args[key] = params[key];
        }
    }

    return { list: list_args, ip: ip_args };
}

/**
 * A transform stream that knows how to filter a network to determine if the IP
 * we care about is in it, and if so, returns it.
 */
function SearchIPNetworkStream(app, log, ip, args) {
    assert.ok(app);
    assert.ok(log);
    assert.ok(ip);
    assert.object(args);

    this.sipn_app = app;
    this.sipn_log = log;
    this.sipn_ip = ip;
    this.sipn_ipkind = ip.kind();
    this.sipn_args = args;

    mod_stream.Transform.call(this, { objectMode: true });
}

mod_util.inherits(SearchIPNetworkStream, mod_stream.Transform);

/**
 * The primary engine behind the transform stream. Determines whether or not
 * this network has an IP address that we care about.
 */
SearchIPNetworkStream.prototype._transform = function (net, _enc, done) {
    var self = this;

    /*
     * Determine whether or not we should even consider this network.
     */
    if (self.sipn_ipkind !== net.subnetStart.kind()) {
        done();
        return;
    }

    if (!net.subnet.contains(self.sipn_ip)) {
        done();
        return;
    }

    /*
     * Use get rather than list here: returnObject in the params
     * ensures that we will get an object back even if there's
     * no record in moray
     */
    var getOpts = {
        app: self.sipn_app,
        log: self.sipn_log,
        params: {
            ip: self.sipn_ip,
            network: net,
            network_uuid: net.uuid
        },
        returnObject: true
    };

    mod_ip.get(getOpts, function (err, ipobj) {
        var sip, prop;
        if (err || !ipobj) {
            done(err);
            return;
        }

        sip = ipobj.serialize();
        for (prop in self.sipn_args) {
            if (!self.sipn_args.hasOwnProperty(prop)) {
                continue;
            }

            if (!sip.hasOwnProperty(prop)) {
                done();
                return;
            }

            if (self.sipn_args[prop] !== sip[prop]) {
                done();
                return;
            }
        }

        self.push(sip);
        done();
    });
};

// --- Endpoints


/**
 * GET /search/ips: search for an IP address across all logical networks
 */
function searchIPs(req, res, next) {

    validate.params(SEARCH_SCHEMA, null, req.params, function (valerr, params) {
        var ipNum, args;

        if (valerr) {
            return next(valerr);
        }

        ipNum = params.ip;
        args = searchIPsFilterArgs(params);

        mod_net.listNetworksStream({
            app: req.app,
            log: req.log,
            params: args.list
        }, function (cerr, stream) {
            var trans;
            var results = [];

            if (cerr) {
                return next(cerr);
            }

            trans = new SearchIPNetworkStream(req.app, req.log, ipNum, args.ip);

            stream.on('error', next);
            trans.on('error', next);

            trans.on('readable', function () {
                var oip;

                for (;;) {
                    oip = trans.read(1);
                    if (oip === null) {
                        return;
                    }

                    results.push(oip);
                }
            });

            trans.on('end', function () {
                if (results.length === 0) {
                    return next(new restify.ResourceNotFoundError(
                        constants.msg.SEARCH_NO_NETS));
                }
                res.send(200, results);
                return next();
            });

            stream.pipe(trans);
        });
    });
}

/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    http.get(
        { path: '/search/ips', name: 'searchIPs' },
        before, searchIPs);
}



module.exports = {
    register: register
};
