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
  var num = util_ip.addressToNumber(req.params.ip_addr);
  if (!num) {
    return next(new restify.InvalidArgumentError(
        'Invalid IP address "%s"', req.params.ip_addr));
  }

  // XXX: also need to determine if:
  // - network really exists
  // - if IP addr belongs in that network
  // - IP is valid (in the case of an IP that doesn't exist in UFDS)

  req.params.ip = num;

  return next();
}



// --- Endpoints



/*
 * GET /networks/:network_uuid/ips: list all IPs in a logical network
 */
function listIPs(req, res, next) {
  mod_ip.list(req.app, req.log, req.params, function (err, ips) {
    if (err) {
      return next(err);
    }

    var serialized = [];
    for (var t in ips) {
      serialized.push(ips[t].serialize());
    }

    res.send(200, serialized);
    return next();
  });
}


/*
 * GET /networks/:network_uuid/ips/:ip_addr: get IP
 */
function getIP(req, res, next) {
  mod_ip.get(req.app, req.log, req.params, function (err, ip) {
    if (err) {
      return next(err);
    }

    // If the IP doesn't exist in UFDS, return a record anyway, so that
    // consumers know it's available
    var ipData = { ip: req.params.ip_addr, reserved: false, free: true };
    if (ip) {
      ipData = ip.serialize();
    }

    res.send(200, ipData);
    return next();
  });
}


/*
 * PUT /networks/:network_uuid/ips/:ip_addr: update IP
 */
function putIP(req, res, next) {
  if (req.params.hasOwnProperty('free') && req.params.free) {
    return mod_ip.del(req.app, req.log, req.params, function (err) {
      if (err && err.statusCode != 404) {
        return next(err);
      }

      var ipData = { ip: req.params.ip_addr, reserved: false, free: true };
      res.send(200, ipData);
      return next();
    });
  }

  return mod_ip.update(req.app, req.log, req.params, function (err, ip) {
    if (err) {
      // We pretend that IPs exist in the UI when they don't exist in UFDS,
      // so that consumers can do a GET on an IP to find out if it's in use.
      // This means that a failure to update here could be because the record
      // doesn't actually exist. We then create it instead.
      if (err.statusCode != 404) {
        return next(err);
      }

      return mod_ip.create(req.app, req.log, req.params, function (err2, ip2) {
        if (err2) {
          return next(err2);
        }

        res.send(200, ip2.serialize());
        return next();
      });
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
