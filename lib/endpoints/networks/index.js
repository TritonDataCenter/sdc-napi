/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI /networks endpoints
 */

'use strict';

var errors = require('../../util/errors');
var mod_common = require('./common');
var mod_net = require('../../models/network');
var mod_pool = require('../../models/network-pool');
var restify = require('restify');



// --- Internal helpers



/**
 * Ensures the network isn't in use in a network pool
 */
function ensureNetworkUnused(req, res, next) {
    return mod_pool.list(req.app, req.log, { }, function (err, pools) {
        if (err) {
            return next(err);
        }

        var usedBy = [];
        for (var p in pools) {
            if (pools[p].networks.indexOf(req.params.uuid) !== -1) {
                usedBy.push(pools[p].uuid);
            }
        }

        if (usedBy.length !== 0) {
            return next(new errors.InUseError('Network is in use',
                usedBy.map(function (uuid) {
                    return errors.usedBy('network pool', uuid);
                })));
        }

        return next();
    });
}



// --- Endpoints



/**
 * GET /networks: list all logical networks
 */
function listNetworks(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.list(opts, function (err, results) {
        req.log.debug('listNetworks: cb entry');
        if (err) {
            return next(err);
        }

        var nets = [];
        for (var n in results) {
            nets.push(results[n].serialize());
        }

        res.send(200, nets);
        return next();
    });
}


/**
 * GET /networks/:uuid: get an individual network
 */
function getNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.get(opts, function (err, net) {
        req.log.trace('getNetwork: cb entry');
        if (err) {
            return next(err);
        }

        if (!net) {
            return next(new restify.ResourceNotFoundError('network not found'));
        }

        res.send(200, net.serialize());
        return next();
    });
}


/**
 * POST /networks: create a network
 */
function postNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.create(opts, function (err, net) {
        req.log.debug('postNetwork: cb entry');
        if (err) {
            return next(err);
        }

        res.send(200, net.serialize());
        return next();
    });
}


/**
 * PUT /networks: update a network
 */
function putNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.update(opts, function (err, net) {
        req.log.debug('putNetwork: cb entry');
        if (err) {
            return next(err);
        }

        var ser = net.serialize();

        res.send(200, ser);
        return next();
    });
}


/**
 * DELETE /networks/:uuid: delete a network
 */
function deleteNetwork(req, res, next) {
    var opts = {
        app: req.app,
        log: req.log,
        params: req.params
    };

    mod_net.del(opts, function (err) {
        req.log.debug('deleteNetwork: cb entry');
        if (err) {
            return next(err);
        }
        res.send(204);
        return next();
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    var netRequired = before.concat([
        mod_common.ensureNetworkExists.bind(null, 'uuid')
    ]);

    http.post({ path: '/networks', name: 'CreateNetwork' },
            before, postNetwork);
    http.get(
        { path: '/networks', name: 'ListNetworks' }, before, listNetworks);
    http.head(
        { path: '/networks', name: 'HeadNetworks' }, before, listNetworks);

    http.get({ path: '/networks/:uuid', name: 'GetNetwork' },
        before, getNetwork);
    http.head({ path: '/networks/:uuid', name: 'HeadNetwork' },
        before, getNetwork);

    http.put({ path: '/networks/:uuid', name: 'PutNetwork' },
        netRequired, putNetwork);

    http.del({ path: '/networks/:uuid', name: 'DeleteNetwork' },
        before.concat(ensureNetworkUnused), deleteNetwork);
}



module.exports = {
    register: register
};
