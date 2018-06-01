/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Test helpers for dealing with aggregations
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');


// --- Globals

var TYPE = 'aggr';


// --- Exports



/**
 * Create an aggregation
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');
    assert.object(opts.params, 'opts.params');

    log.debug({ params: opts.params }, 'creating aggr');
    opts.type = TYPE;
    opts.reqType = 'create';

    client.createAggr(opts.params, common.reqOpts(t, opts),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Delete an aggregation
 */
function del(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.id, 'opts.id');

    var client = opts.client || mod_client.get();
    var params = opts.params || {};

    log.debug({ aggrId: opts.id }, 'delete aggr');
    opts.id = opts.id;
    opts.type = TYPE;

    client.deleteAggr(opts.id, params, common.reqOpts(t, opts),
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Get an aggregation
 */
function get(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.id, 'opts.id');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    log.debug({ aggrId: opts.id }, 'get aggr');

    opts.reqType = 'get';
    opts.type = TYPE;

    client.getAggr(opts.id, common.reqOpts(t, opts),
        common.afterAPIcall.bind(null, t, opts, callback));
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
    var params = opts.params || {};

    assert.object(t, 't');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    log.debug({ params: params }, 'list aggrs');

    opts.reqType = 'list';
    opts.type = TYPE;

    client.listAggrs(params, common.reqOpts(t, opts),
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update an aggregation
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.id, 'opts.id');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.optionalObject(opts.params, 'opts.params');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');
    assert.ok(opts.exp || opts.partialExp || opts.expErr,
            'one of exp, expErr, partialExp required');

    log.debug({ aggrId: opts.id, params: opts.params }, 'updating aggr');

    opts.reqType = 'update';
    opts.type = TYPE;

    client.updateAggr(opts.id, opts.params, common.reqOpts(t, opts),
        common.afterAPIcall.bind(null, t, opts, callback));
}


module.exports = {
    create: create,
    del: del,
    get: get,
    id: id,
    list: list,
    update: update
};
