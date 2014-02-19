/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with aggregations
 */

var common = require('./common');
var log = require('./log');
var util = require('util');



// --- Globals



var NAPI;



// --- Exports



function initState(state) {
    if (!state.hasOwnProperty('aggrs')) {
        state.aggrs = [];
    }
}



// --- Exports



/**
 * Create an aggregation
 */
function create(t, state, params, opts, callback) {
    initState(state);
    log.debug({ params: params }, 'creating aggr');
    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    NAPI.createAggr(params, function (err, obj, _, res) {
        if (opts.expectError) {
            t.ok(err, 'expected error');
            if (err) {
                t.equal(err.statusCode, 422, 'status code');
            }
        } else {
            common.ifErr(t, err, 'create aggr: ' + JSON.stringify(params));
        }

        if (obj) {
            state.aggrs.push(obj);
            t.equal(res.statusCode, 200, 'status code');
        }

        return callback(err, obj);
    });
}


/**
 * Delete an aggregation
 */
function del(t, aggrId, callback) {
    if (typeof (aggrId) === 'object') {
        aggrId = aggrId.id;
    }

    log.debug({ aggrId: aggrId }, 'delete aggr');

    NAPI.deleteAggr(aggrId, function (err, obj, _, res) {
        common.ifErr(t, err, 'delete aggr: ' + aggrId);
        t.equal(res.statusCode, 204, 'delete status code: ' + aggrId);

        return callback(err, obj);
    });
}


/**
 * Get an aggregation
 */
function get(t, aggrId, callback) {
    if (typeof (aggrId) === 'object') {
        aggrId = aggrId.id;
    }

    log.debug({ aggrId: aggrId }, 'get aggr');

    NAPI.getAggr(aggrId, function (err, obj, _, res) {
        common.ifErr(t, err, 'get aggr: ' + aggrId);
        t.equal(res.statusCode, 200, 'get status code: ' + aggrId);

        return callback(err, obj);
    });
}


/**
 * Returns an aggr ID based on the server UUID and name
 */
function id(uuid, name) {
    return util.format('%s-%s', uuid, name);
}


/**
 * List aggregations
 */
function list(t, params, callback) {
    log.debug({ params: params }, 'list aggrs');

    NAPI.listAggrs(params, function (err, obj, _, res) {
        common.ifErr(t, err, 'list aggrs: ' + JSON.stringify(params));
        t.equal(res.statusCode, 200, 'status code: ' + JSON.stringify(params));

        return callback(err, obj);
    });
}


/**
 * Update an aggregation
 */
function update(t, aggr, params, opts, callback) {
    log.debug({ aggr: aggr, params: params }, 'updating aggr');
    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    NAPI.updateAggr(aggr.id, params, function (err, obj, _, res) {
        if (opts.expectError) {
            t.ok(err, 'expected error');
            if (err) {
                t.equal(err.statusCode, 422, 'status code');
            }
        } else {
            common.ifErr(t, err, 'update aggr ' + aggr.id + ': '
                + JSON.stringify(params));
            t.equal(res.statusCode, 200, 'status code');
        }

        return callback(err, obj);
    });
}


module.exports = {
    get client() {
        return NAPI;
    },
    set client(obj) {
        NAPI = obj;
    },

    create: create,
    del: del,
    get: get,
    id: id,
    list: list,
    update: update
};
