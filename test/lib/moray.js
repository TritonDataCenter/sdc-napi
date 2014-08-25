/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for accessing mock moray data
 */

var assert = require('assert-plus');
var mock_moray = require('../lib/mock-moray');
var mod_ip = require('../../lib/models/ip');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');



// --- Exports



/**
 * Returns the moray buckets
 */
function getBuckets() {
    return mock_moray._buckets;
}


/**
 * Gets mock moray errors
 */
function getErrors() {
    return mock_moray._errors;
}


/**
 * Gets an IP record from fake moray
 */
function getIP(network, ip) {
    var buckets = mock_moray._buckets;
    var bucketName = mod_ip.bucket(network).name;
    if (!buckets.hasOwnProperty(bucketName)) {
        return util.format('Bucket %s not found', bucketName);
    }

    var rec = buckets[bucketName][util_ip.aton(ip).toString()];
    if (rec) {
        return rec.value;
    }

    return null;
}


/**
 * Gets all IP records for a network from fake moray
 */
function getIPs(network) {
    var buckets = mock_moray._buckets;
    var bucketName = mod_ip.bucket(network).name;
    if (!buckets.hasOwnProperty(bucketName)) {
        return util.format('Bucket %s not found', bucketName);
    }

    return Object.keys(buckets[bucketName]).map(function (key) {
        return buckets[bucketName][key].value;
    }).sort(function (a, b) { return Number(a.ip) > Number(b.ip); });
}

/**
 * Gets all nic records from fake moray, sorted by MAC address
 */
function getNic(mac, ip) {
    var macNum = util_mac.aton(mac);
    assert.number(macNum, 'Not a valid MAC address');

    return getObj('napi_nics', macNum);
}

/**
 * Gets all nic records from fake moray, sorted by MAC address
 */
function getNics(network, ip) {
    var bucket = mock_moray._buckets.napi_nics;
    assert.object(bucket, 'bucket');

    return Object.keys(bucket).sort().map(function (key) {
        return bucket[key];
    });
}


/**
 * Returns an object from a moray bucket
 */
function getObj(bucketName, key) {
    var bucket = mock_moray._buckets[bucketName];
    assert.object(bucket, 'bucket');
    var obj = bucket[key];
    if (obj) {
        return obj.value;
    }

    return null;
}

/**
 * Sets moray to return errors for the given operations
 */
function setErrors(obj) {
    mock_moray._errors = obj;
}



module.exports = {
    getBuckets: getBuckets,
    getErrors: getErrors,
    getIP: getIP,
    getIPs: getIPs,
    getNic: getNic,
    getNics: getNics,
    getObj: getObj,
    setErrors: setErrors
};
