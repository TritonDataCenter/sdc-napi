/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /nics endpoints
 */

var mod_nic = require('../models/nic');


/*
 * TODO:
 * - enforce that the belongs_to_type of all nics belonging to the same UUID
 *   are the same?
 * - only one nic for a zone can be the primary
 */



// --- Endpoints



/*
 * GET /nics: list all nics
 */
function listNics(req, res, next) {
  var nics = [];
  var app = req.app;
  for (var n in app.data.nics) {
    var nic = mod_nic.lookupNicByMacNumber(app, n);
    if (nic instanceof Error) {
      req.log.error(nic, "listNics: error looking up nic '%d'", n);
      continue;
    }
    if (mod_nic.matchNic(nic, req.params)) {
      nics.push(nic.serialize());
    }
  }
  res.send(200, nics);
  return next();
}


/*
 * Note for all /nics/:mac_address endpoints: according to the w3c URL spec
 * (http://www.w3.org/Addressing/URL/url-spec.txt) and RFC 1738
 * (http://www.ietf.org/rfc/rfc1738.txt), a colon in a HTTP path is reserved
 * and therefore technically not allowed. In the interests of being
 * well-behaved, :mac_address is therefore the address with colons removed.
 * eg: instead of /nics/90:b8:d0:17:37:17, it is /nics/90b8d0173717
 */


/*
 * GET /nics/:mac_address: get an individual nic's data
 */
function getNic(req, res, next) {
  var nic = mod_nic.lookupNicByMacAddress(req.app, req.params.mac_address);
  if (nic instanceof Error) {
    return next(nic);
  }
  res.send(200, nic.serialize());
  return next();
}


/*
 * PUT /nics/:mac_address: modify a nic's parameters
 */
function putNic(req, res, next) {
  mod_nic.updateNic(req.app, req.params, function(err, nic) {
    if (err) {
      return next(err);
    }
    res.send(200, nic.serialize());
    return next();
  });
}


/*
 * POST /nics/:mac_address: modify a nic's parameters
 */
function postNic(req, res, next) {
  mod_nic.createNic(req.app, req.log, null, req.params, function(err, nic) {
    if (err) {
      return next(err);
    }
    res.send(200, nic.serialize());
    return next();
  });
}


/*
 * DELETE /nics/:mac_address: delete a nic
 */
function deleteNic(req, res, next) {
  mod_nic.deleteNic(req.app, req.log, req.params, function(err) {
    if (err) {
      return next(err);
    }
    res.send(204);
    return next();
  });
}



/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.get({ path: '/nics', name: 'ListNics' },
    before, listNics);
  http.head({ path: '/nics', name: 'headNics' },
    before, listNics);
  http.post({ path: '/nics', name: 'postNic' },
      before, postNic);

  http.get({ path: '/nics/:mac_address', name: 'getNic' },
    before, getNic);
  http.head({ path: '/nics/:mac_address', name: 'headNic' },
    before, getNic);
  http.put({ path: '/nics/:mac_address', name: 'putNic' },
      before, putNic);
  http.del({ path: '/nics/:mac_address', name: 'deleteNic' },
    before, deleteNic);
}



module.exports = {
  register: register
};
