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



// --- Exports



/**
 * Create a nic tag
 */
function create(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.optionalObject(opts.exp, 'opts.exp');
    assert.optionalObject(opts.expErr, 'opts.expErr');
    assert.string(opts.name, 'opts.name');
    assert.optionalObject(opts.partialExp, 'opts.partialExp');

    log.debug({ tagName: opts.name }, 'creating nic tag');
    client.createNicTag(opts.name, function (err, obj, _, res) {
        if (common.ifErr(t, err, 'create nic tag ' + opts.name + desc)) {
            return doneErr(err, t, callback);
        }

        common.addToState(opts, 'nic_tags', res);
        t.equal(res.statusCode, 200, 'status code');

        return doneRes(obj, t, callback);
    });
}



module.exports = {
    create: create
};
