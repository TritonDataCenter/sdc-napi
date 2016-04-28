/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for dealing with IPs
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var log = require('./log');
var mod_client = require('./client');

var doneRes = common.doneRes;
var doneErr = common.doneErr;



// --- Globals



var TYPE = 'ip';



// --- Exports



/**
 * Return a free IP record
 */
function freeIPrecord(net, ip) {
    return {
        ip: ip,
        free: true,
        network_uuid: net,
        reserved: false
    };
}


/**
 * Get an IP and compare the output
 */
function getIP(t, opts, callback) {
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
 * List fabric networks
 */
function listIPs(t, opts, callback) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.string(opts.net, 'opts.net');
    assert.optionalBool(opts.deepEqual, 'opts.deepEqual');
    assert.optionalArrayOfObject(opts.present, 'opts.present');

    var client = opts.client || mod_client.get();
    var desc = ' ' + JSON.stringify(opts.params)
        + (opts.desc ? (' ' + opts.desc) : '');
    var params = clone(opts.params);

    if (!opts.desc) {
        opts.desc = desc;
    }

    opts.type = TYPE;
    opts.id = 'ip';

    log.debug({ params: params, net: opts.net }, 'list IPs');

    client.listIPs(opts.net, params, common.reqOpts(t, opts.desc),
        common.afterAPIlist.bind(null, t, opts, callback));
}


/**
 * Update an IP and compare the output
 */
function updateIP(t, opts, callback) {
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
    get: getIP,
    freeIP: freeIPrecord,
    list: listIPs,
    update: updateIP
};
