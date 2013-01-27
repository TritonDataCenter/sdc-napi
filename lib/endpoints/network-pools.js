/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI /network_pools endpoints
 */

var mod_pool = require('../models/network-pool');
var restify = require('restify');
var util = require('util');



// --- Restify handlers



/**
 * GET /network_pools: get the list of network pools
 */
function listNetworkPools(req, res, next) {
  mod_pool.list(req.app, req.log, req.params, function (err, pools) {
    if (err) {
      return next(err);
    }

    var serialized = [];
    for (var p in pools) {
      serialized.push(pools[p].serialize());
    }

    res.send(200, serialized);
    return next();
  });
}


/**
 * POST /network_pools: create a network pool
 */
function postNetworkPool(req, res, next) {
  mod_pool.create(req.app, req.log, req.params, function (err, pool) {
    if (err) {
      return next(err);
    }

    res.send(200, pool.serialize());
    return next();
  });
}


/**
 * GET /network_pools/:uuid: get a network pool
 */
function getNetworkPool(req, res, next) {
  mod_pool.get(req.app, req.log, req.params, function (err, pool) {
    if (err) {
      return next(err);
    }

    if (!pool) {
      return next(new restify.ResourceNotFoundError('not found'));
    }

    res.send(200, pool.serialize());
    return next();
  });
}


/**
 * PUT /network_pools/:uuid: update a network pool
 */
function putNetworkPool(req, res, next) {
  mod_pool.update(req.app, req.log, req.params, function (err, pool) {
    if (err) {
      return next(err);
    }

    res.send(200, pool.serialize());
    return next();
  });
}


/**
 * DELETE /network_pools/:uuid: delete a network pool
 */
function deleteNetworkPool(req, res, next) {
  mod_pool.del(req.app, req.log, req.params, function (err) {
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
  http.get({ path: '/network_pools', name: 'listNetworkPools' },
    before, listNetworkPools);
  http.head({ path: '/network_pools', name: 'headNetworkPools' },
    before, listNetworkPools);
  http.post({ path: '/network_pools', name: 'postNetworkPool' },
      before, postNetworkPool);

  http.get({ path: '/network_pools/:uuid', name: 'getNetworkPool' },
    before, getNetworkPool);
  http.head({ path: '/network_pools/:uuid', name: 'headNetworkPool' },
    before, getNetworkPool);
  http.put({ path: '/network_pools/:uuid', name: 'putNetworkPool' },
      before, putNetworkPool);
  http.del({ path: '/network_pools/:uuid', name: 'deleteNetworkPool' },
    before, deleteNetworkPool);
}



module.exports = {
  register: register
};
