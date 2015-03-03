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
 * Create a nic tag, compare the output, then do the same for a get of
 * that tag.
 */
function createAndGetTag(t, opts, callback) {
    createTag(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return getTag(t, opts, callback);
    });
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
 * Get a nic tag
 */
function getTag(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    var client = opts.client || mod_client.get();
    var name = opts.name || opts.params.name;
    assert.string(name, 'opts.name');

    opts.reqType = 'get';
    opts.type = TYPE;
    log.debug({ tagName: name }, 'getting nic tag');

    client.getNicTag(name,
        common.afterAPIcall.bind(null, t, opts, callback));
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


/**
 * Update a nic tag and compare the output
 */
function updateTag(t, opts, callback) {
    common.assertArgs(t, opts, callback);
    assert.string(opts.name, 'opts.name');

    var client = opts.client || mod_client.get();
    var name = opts.name;

    opts.type = TYPE;
    opts.reqType = 'update';

    client.updateNicTag(name, opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
}


/**
 * Update a nic tag, compare the output, then do the same for a get of
 * that tag.
 */
function updateAndGetTag(t, opts, callback) {
    updateTag(t, opts, function (err, res) {
        if (err) {
            return doneErr(err, t, callback);
        }

        return getTag(t, opts, callback);
    });
}



module.exports = {
    create: createTag,
    createAndGet: createAndGetTag,
    del: delTag,
    get: getTag,
    lastCreated: lastCreated,
    list: listTags,
    update: updateTag,
    updateAndGet: updateAndGetTag
};
