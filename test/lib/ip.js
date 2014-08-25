/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for dealing with IPs
 */

var assert = require('assert-plus');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Exports



/**
 * Get an IP and compare the output
 */
function get(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.net, 'opts.net');
    assert.string(opts.ip, 'opts.ip');
    assert.object(opts.exp, 'opts.exp');

    client.getIP(opts.net, opts.ip, function (err, res) {
        if (common.ifErr(t, err, 'get IP ' + opts.ip + desc)) {
            return doneErr(err, t, callback);
        }

        t.deepEqual(res, opts.exp, 'full result' + desc);
        return doneRes(res, t, callback);
    });
}


/**
 * Update an IP and compare the output
 */
function update(t, opts, callback) {
    var client = opts.client || mod_client.get();
    var desc = opts.desc ? (' ' + opts.desc) : '';

    assert.object(t, 't');
    assert.string(opts.net, 'opts.net');
    assert.string(opts.ip, 'opts.ip');
    assert.object(opts.params, 'opts.params');
    assert.object(opts.exp, 'opts.exp');

    client.updateIP(opts.net, opts.ip, opts.params, function (err, res) {
        if (common.ifErr(t, err, 'update IP ' + opts.ip + desc)) {
            return doneErr(err, t, callback);
        }

        t.deepEqual(res, opts.exp, 'full result' + desc);
        return doneRes(res, t, callback);
    });
}



module.exports = {
    get: get,
    update: update
};
