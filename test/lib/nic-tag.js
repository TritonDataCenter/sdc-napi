/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
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
var TYPE = 'nic_tag';



// --- Exports



/**
 * Create a nic tag
 */
function createTag(t, opts, callback) {
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
    opts.type = TYPE;
    log.debug({ tagName: name }, 'creating nic tag');

    client.createNicTag(name,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Delete a nic tag
 */
function delTag(t, opts, callback) {
    var client = opts.client || mod_client.get();

    assert.object(t, 't');
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.expErr, 'opts.expErr');

    opts.type = TYPE;
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


/**
 * List nic tags
 */
function listTags(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.optionalBool(opts.deepEqual, 'opts.deepEqual');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var params = opts.params || {};
    var desc = ' ' + JSON.stringify(params)
        + (opts.desc ? (' ' + opts.desc) : '');

    if (!opts.desc) {
        opts.desc = desc;
    }
    opts.id = 'name';
    opts.type = TYPE;

    log.debug({ params: params }, 'list nic tags');

    client.listNicTags(params, common.reqOpts(t, opts.desc),
        common.afterAPIlist.bind(null, t, opts, callback));
}



module.exports = {
    create: createTag,
    del: delTag,
    lastCreated: lastCreated,
    list: listTags
};
