/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with aggregations
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Internal



function addToState(opts, obj) {
    if (!opts.state || !obj) {
        return;
    }

    var newObj = clone(obj);
    if (!opts.state.hasOwnProperty('aggrs')) {
        opts.state.aggrs = [];
    }

    if (opts.hasOwnProperty('stateProp')) {
        if (!opts.state.hasOwnProperty(opts.stateProp)) {
            opts.state[opts.stateProp] = [];
        }

        opts.state[opts.stateProp].push(newObj);
    }

    opts.state.aggrs.push(newObj);
}



// --- Exports



/**
 * Create an aggregation
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    log.debug({ params: opts.params }, 'creating aggr');
    client.createAggr(opts.params, function (err, obj, _, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'create aggr: '
            + JSON.stringify(opts.params))) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(obj[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        addToState(opts, obj);
        t.equal(res.statusCode, 200, 'status code');

        return doneRes(obj, t, callback);
    });
}


/**
 * Delete an aggregation
 */
function del(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.id, 'opts.id');

    log.debug({ aggrId: opts.id }, 'delete aggr');

    client.deleteAggr(opts.id, function (err, obj, _, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'delete aggr: ' + opts.id + desc)) {
            return doneErr(err, t, callback);
        }

        t.equal(res.statusCode, 204, 'delete status code: ' + opts.id);

        return doneRes(obj, t, callback);
    });
}


/**
 * Get an aggregation
 */
function get(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.id, 'opts.id');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    log.debug({ aggrId: opts.id }, 'get aggr');

    client.getAggr(opts.id, function (err, obj, _, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'get aggr: ' + opts.id + desc)) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(obj[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        t.equal(res.statusCode, 200, 'status code');

        return doneRes(obj, t, callback);
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
function list(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';
    var params = opts.params || {};

    assert.object(t, 't');
    log.debug({ params: params }, 'list aggrs');

    client.listAggrs(params, function (err, obj, _, res) {
        common.ifErr(t, err, 'list aggrs: ' + JSON.stringify(params) + desc);
        t.equal(res.statusCode, 200,
            'status code: ' + JSON.stringify(params) + desc);

        return callback(err, obj);
    });
}


/**
 * Update an aggregation
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.id, 'opts.id');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    log.debug({ aggrId: opts.id, params: opts.params }, 'updating aggr');

    client.updateAggr(opts.id, opts.params, function (err, obj, _, res) {
        if (opts.expErr) {
            t.ok(err, 'expected error');
            if (err) {
                var code = opts.expCode || 422;
                t.equal(err.statusCode, code, 'status code');
                t.deepEqual(err.body, opts.expErr, 'error body');
            }

            return doneErr(err, t, callback);
        }

        if (common.ifErr(t, err, 'update aggr: ' + opts.id + desc)) {
            return doneErr(err, t, callback);
        }

        if (opts.exp) {
            t.deepEqual(obj, opts.exp, 'full result' + desc);
        }

        if (opts.partialExp) {
            for (var p in opts.partialExp) {
                t.equal(obj[p], opts.partialExp[p], p + ' correct' + desc);
            }
        }

        t.equal(res.statusCode, 200, 'status code');

        return doneRes(obj, t, callback);
    });
}


module.exports = {
    create: create,
    del: del,
    get: get,
    id: id,
    list: list,
    update: update
};
