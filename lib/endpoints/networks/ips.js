/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /networks/:network_uuid/ips endpoints
 */

var restify = require('restify');

var mod_ip = require('../../models/ip.js');
var util_ip = require('../../util/ip.js');



// --- Helper functions



/*
 * Validate network and IP before calling ips/:ip_addr endpoints
 */
function beforeValidateParams(req, res, next) {
  var network = req.app.data.networks[req.params.network_uuid];
  if (!network) {
    res.send(404);
    return next();
  }

  var num = util_ip.addressToNumber(req.params.ip_addr);
  if (!num) {
    return next(new restify.InvalidArgumentError(
        'Invalid IP address "%s"', req.params.ip_addr));
  }

  req.ipNum = num;

  return next();
}



// --- Endpoints



/*
 * /networks/:network_uuid/ips: list all logical networks
 */
function listIPs(req, res, next) {
  if (!req.app.data.networks.hasOwnProperty(req.params.network_uuid)) {
    res.send(404);
    return next();
  }

  var ips = mod_ip.listNetworkIPs(req.app, req.params, req.log);
  if (ips.length === 0) {
    res.send(204);
    return next();
  }

  res.send(200, ips);
  return next();
}


/*
 * GET /networks/:network_uuid/ips/:ip_addr: get IP
 */
function getIP(req, res, next) {
  var ip = mod_ip.getIP(req.app, req.params.network_uuid, req.ipNum, req.log);
  if (!ip) {
    res.send(404);
    return next();
  }
  if (ip instanceof Error) {
    return next(ip);
  }

  res.send(200, ip.serialize());
  return next();
}


/*
 * PUT /networks/:network_uuid/ips/:ip_addr: update IP
 */
function putIP(req, res, next) {
  mod_ip.updateIP(req.app, req.params.network_uuid, req.ipNum, req.params,
    function (err, ip) {
      if (err) {
        return next(err);
      }

      res.send(200, ip.serialize());
      return next();
    });
}


/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  var beforeIP = before.concat(beforeValidateParams);

  http.get(
    { path: '/networks/:network_uuid/ips', name: 'ListIPs' },
    before, listIPs);
  http.head(
    { path: '/networks/:network_uuid/ips', name: 'headIPs' },
    before, listIPs);
  http.get(
    { path: '/networks/:network_uuid/ips/:ip_addr', name: 'getIP' },
    beforeIP, getIP);
  http.put(
    { path: '/networks/:network_uuid/ips/:ip_addr', name: 'putIP' },
    beforeIP, putIP);
}



module.exports = {
  register: register
};
