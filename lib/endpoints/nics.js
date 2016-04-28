/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * NAPI /nics endpoints
 */

'use strict';

var mod_nic = require('../models/nic');
var reqToOpts = require('../util/common').reqToOpts;
var restify = require('restify');
var util = require('util');



/*
 * TODO:
 * - enforce that the belongs_to_type of all nics belonging to the same UUID
 *   are the same?
 */



// --- Endpoints



/**
 * GET /nics: list all nics
 */
function listNics(req, res, next) {
    mod_nic.list(reqToOpts(req), function (err, nics) {
        req.log.debug('listNics: cb entry');
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var t in nics) {
            serialized.push(nics[t].serialize());
        }

        res.send(200, serialized);
        return next();
    });
}


/*
 * Note for all /nics/:mac endpoints: according to the w3c URL spec
 * (http://www.w3.org/Addressing/URL/url-spec.txt) and RFC 1738
 * (http://www.ietf.org/rfc/rfc1738.txt), a colon in a HTTP path is reserved
 * and therefore technically not allowed. In the interests of being
 * well-behaved, :mac is specified by either:
 * - the address with colons removed.(eg: /nics/90b8d0173717)
 * - the address with dashes instead of colons (eg: /nics/90-b8-d0-17-37-17)
 */


/**
 * GET /nics/:mac: get a nic
 */
function getNic(req, res, next) {
    mod_nic.get(reqToOpts(req), function (err, nic) {
        req.log.debug({ err: err, nic: nic }, 'getNic: cb entry');
        if (err) {
            return next(err);
        }

        if (!nic) {
            return next(new restify.ResourceNotFoundError(
                util.format('Unknown nic "%s"', req.params.mac)));
        }

        res.send(200, nic.serialize());
        return next();
    });
}


/**
 * PUT /nics/:mac_address: modify a nic's parameters
 */
function putNic(req, res, next) {
    mod_nic.update(reqToOpts(req), function (err, nic) {
        req.log.debug({ err: err, nic: nic }, 'putNic: cb entry');
        if (err) {
            return next(err);
        }
        res.send(200, nic.serialize());
        return next();
    });
}


/**
 * POST /nics: create a nic
 */
function postNic(req, res, next) {
    mod_nic.create(reqToOpts(req), function (err, nic) {
        req.log.debug({ err: err, nic: nic }, 'postNic: cb entry');
        if (err) {
            return next(err);
        }

        res.send(200, nic.serialize());
        return next();
    });
}


/**
 * DELETE /nics/:mac: delete a nic
 */
function deleteNic(req, res, next) {
    mod_nic.del(reqToOpts(req), function (err) {
        req.log.debug({ err: err }, 'deleteNic: cb entry');
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
    http.get({ path: '/nics', name: 'ListNics' },
        before, listNics);
    http.head({ path: '/nics', name: 'HeadNics' },
        before, listNics);
    http.post({ path: '/nics', name: 'CreateNic' },
            before, postNic);

    http.get({ path: '/nics/:mac', name: 'GetNic' },
        before, getNic);
    http.head({ path: '/nics/:mac', name: 'HeadNic' },
        before, getNic);
    http.put({ path: '/nics/:mac', name: 'UpdateNic' },
            before, putNic);
    http.del({ path: '/nics/:mac', name: 'DeleteNic' },
        before, deleteNic);
}



module.exports = {
    register: register
};
