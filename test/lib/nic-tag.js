/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with nic tags
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');
var util = require('util');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Globals



var NUM = 0;



// --- Exports



/**
 * Create a nic tag
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    var name = opts.name;
    if (name == '<generate>') {
        name = util.format('test_tag%d_%d', NUM++, process.pid);
    }

    opts.reqType = 'create';
    opts.type = 'nic_tag';
    log.debug({ tagName: name }, 'creating nic tag');

    client.createNicTag(name,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Delete a nic tag
 */
function del(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    opts.type = 'nic_tag';
    opts.id = opts.name;
    var params = opts.params || {};

    client.deleteNicTag(opts.name, params,
        common.afterAPIdelete.bind(null, t, opts, callback));
}


/**
 * Returns the most recently created nic tag
 */
function lastCreated() {
    return common.lastCreated('nic_tags');
}



module.exports = {
    create: create,
    del: del,
    lastCreated: lastCreated
};
