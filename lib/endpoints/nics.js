/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /nics endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_nic = require('../models/nic');
var reqToOpts = require('../util/common').reqToOpts;
var restify = require('restify');



/*
 * TODO:
 * - enforce that the belongs_to_type of all nics belonging to the same UUID
 *   are the same?
 */

// --- Internal helpers

/**
 * Ensures that the NIC exists, returning 404 if it does not. If it exists, then
 * the NIC is stored in req._nic so it can be used for further validation.
 */
function ensureNicExists(req, res, next) {
    mod_nic.get(reqToOpts(req), function (err, nic) {
        if (err) {
            next(err);
            return;
        }

        req._nic = nic;
        res.etag = nic.etag;

        next();
    });
}



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
 * well-behaved, clients should send :mac as either:
 *
 * - the address with colons removed.(eg: /nics/90b8d0173717)
 * - the address with dashes instead of colons (eg: /nics/90-b8-d0-17-37-17)
 *
 * NAPI will accept a MAC with colons (90:b8:d0:17:37:17), but this should
 * only be taken advantage of by humans and avoided by software consumers.
 */


/**
 * GET /nics/:mac: get a nic
 */
function getNic(req, res, next) {
    assert.object(req._nic, 'req._nic');
    res.header('Etag', req._nic.etag);
    res.send(200, req._nic.serialize());
    next();
}


/**
 * PUT /nics/:mac_address: modify a nic's parameters
 */
function putNic(req, res, next) {
    assert.object(req._nic, 'req._nic');

    mod_nic.update(reqToOpts(req, {
        existingNic: req._nic
    }), function (err, nic) {
        req.log.debug({ err: err, nic: nic }, 'putNic: cb entry');
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', nic.etag);
        res.send(200, nic.serialize());

        next();
    });
}


/**
 * POST /nics: create a nic
 */
function postNic(req, res, next) {
    mod_nic.create(reqToOpts(req), function (err, nic) {
        req.log.debug({ err: err, nic: nic }, 'postNic: cb entry');
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', nic.etag);
        res.send(200, nic.serialize());

        next();
    });
}


/**
 * DELETE /nics/:mac: delete a nic
 */
function deleteNic(req, res, next) {
    assert.object(req._nic, 'req._nic');

    mod_nic.del(reqToOpts(req, {
        existingNic: req._nic
    }), function (err) {
        req.log.debug({ err: err }, 'deleteNic: cb entry');
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
    var nicRequired = before.concat([
        ensureNicExists,
        restify.conditionalRequest()
    ]);

    http.get({ path: '/nics', name: 'ListNics' },
        before, listNics);
    http.head({ path: '/nics', name: 'HeadNics' },
        before, listNics);
    http.post({ path: '/nics', name: 'CreateNic' },
            before, postNic);

    http.get({ path: '/nics/:mac', name: 'GetNic' },
        nicRequired, getNic);
    http.head({ path: '/nics/:mac', name: 'HeadNic' },
        nicRequired, getNic);
    http.put({ path: '/nics/:mac', name: 'UpdateNic' },
        nicRequired, putNic);
    http.del({ path: '/nics/:mac', name: 'DeleteNic' },
        nicRequired, deleteNic);
}



module.exports = {
    register: register
};
