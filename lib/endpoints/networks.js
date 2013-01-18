/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks endpoints
 */

var mod_net = require('../models/network.js');
var restify = require('restify');
var util = require('util');



// --- Endpoints



/**
 * GET /networks: list all logical networks
 */
function listNetworks(req, res, next) {
  mod_net.list(req.app, req.log, req.params, function (err, results) {
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
  mod_net.get(req.app, req.log, req.params, function (err, net) {
    req.log.debug('getNetwork: cb entry');
    if (err) {
      return next(err);
    }

    if (!net) {
      return next(new restify.ResourceNotFoundError(
        util.format('Unknown network "%s"', req.params.uuid)));
    }

    res.send(200, net.serialize());
    return next();
  });
}


/**
 * POST /networks: create a network
 */
function postNetwork(req, res, next) {
  mod_net.create(req.app, req.log, req.params, function (err, net) {
    req.log.debug('postNetwork: cb entry');
    if (err) {
      return next(err);
    }

    res.send(200, net.serialize());
    return next();
  });
}


/**
 * DELETE /networks/:uuid: delete a network
 */
function deleteNetwork(req, res, next) {
  mod_net.del(req.app, req.log, req.params, function (err, tag) {
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
  http.post({ path: '/networks', name: 'postNetwork' },
      before, postNetwork);
  http.get(
    { path: '/networks', name: 'listNetworks' }, before, listNetworks);
  http.head(
    { path: '/networks', name: 'headNetworks' }, before, listNetworks);

  http.get({ path: '/networks/:uuid', name: 'getNetwork' },
    before, getNetwork);
  http.head({ path: '/networks/:uuid', name: 'headNetwork' },
    before, getNetwork);

  /*
   * XXX: implement PUT
   * http.put({ path: '/nics/:mac_address', name: 'putNic' },
   *   before, putNic);
   */

  http.del({ path: '/networks/:uuid', name: 'deleteNetwork' },
    before, deleteNetwork);
}



module.exports = {
  register: register
};
