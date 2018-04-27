/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /aggregations endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_aggr = require('../models/aggregation');
var reqToOpts = require('../util/common').reqToOpts;
var restify = require('restify');


// --- Internal helpers

/**
 * Ensures that the aggregation exists, returning 404 if it does not. If it
 * exists, then the aggregation is stored in req._aggr so it can be used for
 * further validation.
 */
function ensureAggrExists(req, res, next) {
    mod_aggr.get(reqToOpts(req), function (err, aggr) {
        if (err) {
            next(err);
            return;
        }

        req._aggr = aggr;
        res.etag = aggr.etag;

        next();
    });
}



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
    mod_aggr.create(reqToOpts(req), function (err, aggr) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', aggr.etag);
        res.send(200, aggr.serialize());

        next();
    });
}


/**
 * GET /aggregations/:id: get an aggregation
 */
function getAggregation(req, res, next) {
    assert.object(req._aggr, 'req._aggr');
    res.header('Etag', req._aggr.etag);
    res.send(200, req._aggr.serialize());
    next();
}


/**
 * PUT /aggregations/:id: update an aggregation
 */
function putAggregation(req, res, next) {
    assert.object(req._aggr, 'req._aggr');

    mod_aggr.update(reqToOpts(req, {
        existingAggr: req._aggr
    }), function (err, aggr) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', aggr.etag);
        res.send(200, aggr.serialize());

        next();
    });
}


/**
 * DELETE /aggregations/:id: delete an aggregation
 */
function deleteAggregation(req, res, next) {
    mod_aggr.del(reqToOpts(req), function (err) {
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
    var aggrRequired = before.concat([
        ensureAggrExists,
        restify.conditionalRequest()
    ]);

    http.get({ path: '/aggregations', name: 'ListAggregations' },
        before, listAggregations);
    http.head({ path: '/aggregations', name: 'HeadAggregations' },
        before, listAggregations);

    http.post({ path: '/aggregations', name: 'CreateAggregation' },
            before, postAggregation);

    http.get({ path: '/aggregations/:id', name: 'GetAggregation' },
        aggrRequired, getAggregation);
    http.head({ path: '/aggregations/:id', name: 'HeadAggregation' },
        aggrRequired, getAggregation);

    http.put({ path: '/aggregations/:id', name: 'UpdateAggregation' },
        aggrRequired, putAggregation);

    http.del({ path: '/aggregations/:id', name: 'DeleteAggregation' },
        aggrRequired, deleteAggregation);
}



module.exports = {
    register: register
};
