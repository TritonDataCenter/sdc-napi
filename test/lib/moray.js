/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Test helpers for accessing mock moray data
 */

'use strict';

var assert = require('assert-plus');
var mod_ip = require('../../lib/models/ip');
var mod_mac = require('macaddr');
var models = require('../../lib/models');


// --- Internals


function extractValue(callback) {
    assert.func(callback, 'callback');

    return function _extractValue(err, res) {
        if (res) {
            res = res.value;
        }
        callback(err, res);
    };
}


// --- Exports


/**
 * Gets an IP record from Moray.
 */
function getIP(moray, network, ip, callback) {
    var bucket = mod_ip.bucketName(network);
    moray.getObject(bucket, ip, extractValue(callback));
}


/**
 * Gets all IP records for a network from Moray, sorted by address.
 */
function getIPs(moray, network, callback) {
    var bucket = mod_ip.bucketName(network);
    var ips = [];
    var res = moray.findObjects(bucket, '(ipaddr=*)', {
        sort: {
            attribute: 'ipaddr',
            order: 'ASC'
        }
    });
    res.on('error', callback);
    res.on('record', function (obj) { ips.push(obj.value); });
    res.on('end', function () { callback(null, ips); });
}


/**
 * Gets a NIC record from Moray.
 */
function getNic(moray, mac, callback) {
    var bucket = models.nic.bucket().name;
    var key = mod_mac.parse(mac).toLong().toString();

    moray.getObject(bucket, key, extractValue(callback));
}


/**
 * Counts all NIC records in Moray.
 */
function countNics(moray, callback) {
    var bucket = models.nic.bucket().name;
    var count = 0;
    var res = moray.findObjects(bucket, '(mac=*)', { limit: 1 });
    res.on('error', callback);
    res.on('record', function (r) {
        count = r._count;
    });
    res.on('end', function () {
        callback(null, count);
    });
}


module.exports = {
    getIP: getIP,
    getIPs: getIPs,
    getNic: getNic,
    countNics: countNics
};
