/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018, Joyent, Inc.
 */

/*
 * NAPI /routers endpoints
 */

'use strict';

var mod_router = require('../models/router');
var restify = require('restify');



// --- Restify handlers



/**
 * GET /routers: get the list of router objects
 */
function listRouters(req, res, next) {
    mod_router.list(req.app, req.log, req.params, function (err, routers) {
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var p in routers) {
            serialized.push(routers[p].serialize());
        }

        res.send(200, serialized);
        return next();
    });
}


/**
 * POST /routers: create a router object
 */
function postRouter(req, res, next) {
    mod_router.create(req.app, req.log, req.params, function (err, router) {
        if (err) {
            return next(err);
        }

        res.send(200, router.serialize());
        return next();
    });
}


/**
 * GET /routers/:uuid: get a router object
 */
function getRouter(req, res, next) {
    mod_router.get(req.app, req.log, req.params, function (err, router) {
        if (err) {
            return next(err);
        }

        if (!router) {
            return next(new restify.ResourceNotFoundError('not found'));
        }

        res.send(200, router.serialize());
        return next();
    });
}


/**
 * PUT /routers/:uuid: update a router object
 */
function putRouter(req, res, next) {
    mod_router.update(req.app, req.log, req.params, function (err, router) {
        if (err) {
            return next(err);
        }

        res.send(200, router.serialize());
        return next();
    });
}


/**
 * DELETE /routers/:uuid: delete a router object
 */
function deleteRouter(req, res, next) {
    mod_router.del(req.app, req.log, req.params, function (err) {
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
    http.get({ path: '/routers', name: 'ListRouters' },
        before, listRouters);
    http.head({ path: '/routers', name: 'HeadRouters' },
        before, listRouters);
    http.post({ path: '/routers', name: 'CreateRouter' },
            before, postRouter);

    http.get({ path: '/routers/:uuid', name: 'GetRouter' },
        before, getRouter);
    http.head({ path: '/routers/:uuid', name: 'HeadRouter' },
        before, getRouter);
    http.put({ path: '/routers/:uuid', name: 'UpdateRouter' },
            before, putRouter);
    http.del({ path: '/routers/:uuid', name: 'DeleteRouter' },
        before, deleteRouter);
}



module.exports = {
    register: register
};
