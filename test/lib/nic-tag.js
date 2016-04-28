/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for dealing with nic tags
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var config = require('./config');
var log = require('./log');
var mod_client = require('./client');
var mod_vasync = require('vasync');
var util = require('util');

var doneErr = common.doneErr;



// --- Globals



var DEFAULT_NIC_TAG = config.defaults.nic_tag_name;
var NUM = 0;
var TYPE = 'nic_tag';



// --- Exports



/**
 * Create the default nic tag
 */
function createDefaultTag(t) {
    createTag(t, {
        name: DEFAULT_NIC_TAG,
        exp: {
            name: DEFAULT_NIC_TAG,
            mtu: 1500
        }
    });
}


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
    var params = opts.params || {};
    if (name === '<generate>') {
        name = util.format('test_tag%d_%d', NUM++, process.pid);
    }

    opts.idKey = 'uuid';
    opts.reqType = 'create';
    opts.type = TYPE;
    log.debug({ tagName: name }, 'creating nic tag');

    client.createNicTag(name, params,
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
 * Delete all the nic tags created by this test
 */
function delAllCreatedTags(t) {
    assert.object(t, 't');

    var created = common.allCreated(TYPE + 's');
    if (created.length === 0) {
        t.ok(true, 'No nic tags created');
        return t.end();
    }

    mod_vasync.forEachParallel({
        inputs: created,
        func: function _delOne(tag, cb) {
            var delOpts = {
                continueOnErr: true,
                exp: {},
                name: tag
            };

            delTag(t, delOpts, cb);
        }
    }, function () {
        return t.end();
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

    client.updateNicTag(name, opts.params, common.reqOpts(t, opts.desc),
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

        if (opts.params && opts.params.name) {
            // We've update the tag name, so we have to get it with the
            // new name:
            opts.name = opts.params.name;
        }

        return getTag(t, opts, callback);
    });
}



module.exports = {
    create: createTag,
    createDefault: createDefaultTag,
    createAndGet: createAndGetTag,
    del: delTag,
    delAllCreated: delAllCreatedTags,
    get: getTag,
    lastCreated: lastCreated,
    list: listTags,
    update: updateTag,
    updateAndGet: updateAndGetTag
};
