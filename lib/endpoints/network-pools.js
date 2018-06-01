/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /network_pools endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_pool = require('../models/network-pool');
var reqToOpts = require('../util/common').reqToOpts;
var restify = require('restify');



// --- Restify handlers

/**
 * Ensures that the pool exists, returning 404 if it does not. If it exists,
 * then the pool is stored in req._pool so it can be used for further
 * validation.
 */
function ensurePoolExists(req, res, next) {
    mod_pool.get(req.app, req.log, req.params, function (err, pool) {
        if (err) {
            next(err);
            return;
        }

        req._pool = pool;
        res.etag = pool.etag;

        next();
    });
}




/**
 * GET /network_pools: get the list of network pools
 */
function listNetworkPools(req, res, next) {
    mod_pool.list(reqToOpts(req), function (err, pools) {
        if (err) {
            next(err);
            return;
        }

        var serialized = [];
        for (var p in pools) {
            serialized.push(pools[p].serialize());
        }

        res.send(200, serialized);
        next();
    });
}


/**
 * POST /network_pools: create a network pool
 */
function postNetworkPool(req, res, next) {
    mod_pool.create(reqToOpts(req), function (err, pool) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', pool.etag);
        res.send(200, pool.serialize());

        next();
    });
}


/**
 * GET /network_pools/:uuid: get a network pool
 */
function getNetworkPool(req, res, next) {
    assert.object(req._pool, 'req._pool');
    res.header('Etag', req._pool.etag);
    res.send(200, req._pool.serialize());
    next();
}


/**
 * PUT /network_pools/:uuid: update a network pool
 */
function putNetworkPool(req, res, next) {
    assert.object(req._pool, 'req._pool');

    mod_pool.update(reqToOpts(req, {
        oldPool: req._pool
    }), function (err, pool) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', pool.etag);
        res.send(200, pool.serialize());

        next();
    });
}


/**
 * DELETE /network_pools/:uuid: delete a network pool
 */
function deleteNetworkPool(req, res, next) {
    assert.object(req._pool, 'req._pool');

    mod_pool.del(reqToOpts(req, {
        existingPool: req._pool
    }), function (err) {
        if (err) {
            next(err);
            return;
        }

        res.send(204);
        next();
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    var poolRequired = before.concat([
        ensurePoolExists,
        restify.conditionalRequest()
    ]);

    http.get({ path: '/network_pools', name: 'ListNetworkPools' },
        before, listNetworkPools);
    http.head({ path: '/network_pools', name: 'HeadNetworkPools' },
        before, listNetworkPools);
    http.post({ path: '/network_pools', name: 'CreateNetworkPool' },
        before, postNetworkPool);

    http.get({ path: '/network_pools/:uuid', name: 'GetNetworkPool' },
        poolRequired, getNetworkPool);
    http.head({ path: '/network_pools/:uuid', name: 'HeadNetworkPool' },
        poolRequired, getNetworkPool);
    http.put({ path: '/network_pools/:uuid', name: 'UpdateNetworkPool' },
        poolRequired, putNetworkPool);
    http.del({ path: '/network_pools/:uuid', name: 'DeleteNetworkPool' },
        poolRequired, deleteNetworkPool);
}



module.exports = {
    register: register
};
