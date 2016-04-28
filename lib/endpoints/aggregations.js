/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * NAPI /aggregations endpoints
 */

'use strict';

var mod_aggr = require('../models/aggregation');
var restify = require('restify');



// --- Restify handlers



/**
 * GET /aggregations: get the list of network pools
 */
function listAggregations(req, res, next) {
    mod_aggr.list({ app: req.app, log: req.log, params: req.params },
        function (err, aggrs) {
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var p in aggrs) {
            serialized.push(aggrs[p].serialize());
        }

        res.send(200, serialized);
        return next();
    });
}


/**
 * POST /aggregations: create an aggregation
 */
function postAggregation(req, res, next) {
    mod_aggr.create({ app: req.app, log: req.log, params: req.params },
        function (err, aggr) {
        if (err) {
            return next(err);
        }

        res.send(200, aggr.serialize());
        return next();
    });
}


/**
 * GET /aggregations/:id: get an aggregation
 */
function getAggregation(req, res, next) {
    mod_aggr.get({ app: req.app, log: req.log, params: req.params },
        function (err, aggr) {
        if (err) {
            return next(err);
        }

        if (!aggr) {
            return next(new restify.ResourceNotFoundError('not found'));
        }

        res.send(200, aggr.serialize());
        return next();
    });
}


/**
 * PUT /aggregations/:id: update an aggregation
 */
function putAggregation(req, res, next) {
    mod_aggr.update({ app: req.app, log: req.log, params: req.params },
        function (err, aggr) {
        if (err) {
            return next(err);
        }

        res.send(200, aggr.serialize());
        return next();
    });
}


/**
 * DELETE /aggregations/:id: delete an aggregation
 */
function deleteAggregation(req, res, next) {
    mod_aggr.del({ app: req.app, log: req.log, params: req.params },
        function (err) {
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
    http.get({ path: '/aggregations', name: 'ListAggregations' },
        before, listAggregations);
    http.head({ path: '/aggregations', name: 'HeadAggregations' },
        before, listAggregations);

    http.post({ path: '/aggregations', name: 'CreateAggregation' },
            before, postAggregation);

    http.get({ path: '/aggregations/:id', name: 'GetAggregation' },
        before, getAggregation);
    http.head({ path: '/aggregations/:id', name: 'HeadAggregation' },
        before, getAggregation);

    http.put({ path: '/aggregations/:id', name: 'UpdateAggregation' },
            before, putAggregation);

    http.del({ path: '/aggregations/:id', name: 'DeleteAggregation' },
        before, deleteAggregation);
}



module.exports = {
    register: register
};
