/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Common test helpers shared between integration and unit tests
 */

var assert = require('assert-plus');
var mod_err = require('../../lib/util/errors');


// --- Exported functions



/*
 * Generate a valid random MAC address (multicast bit not set, locally
 * administered bit set)
 */
function randomMAC() {
    var data = [(Math.floor(Math.random() * 15) + 1).toString(16) + 2];
    for (var i = 0; i < 5; i++) {
         var oct = (Math.floor(Math.random() * 255)).toString(16);
         if (oct.length == 1) {
                oct = '0' + oct;
         }
         data.push(oct);
    }

    return data.join(':');
}


/**
 * Calls t.ifError, outputs the error body for diagnostic purposes, and
 * returns true if there was an error
 */
function ifErr(t, err, desc) {
    t.ifError(err, desc);
    if (err) {
        t.deepEqual(err.body, {}, desc + ': error body');
        return true;
    }

    return false;
}


/**
 * Returns an invalid parameter error body, overriding with fields in
 * extra
 */
function invalidParamErr(extra) {
    assert.optionalObject(extra, 'extra');

    var newErr = {
        code: 'InvalidParameters',
        message: mod_err.INVALID_MSG
    };

    for (var e in extra) {
        newErr[e] = extra[e];
    }

    return newErr;
}


/**
 * Returns an missing parameter error body, overriding with fields in
 * extra
 */
function missingParamErr(extra) {
    assert.optionalObject(extra, 'extra');

    var newErr = {
        code: 'InvalidParameters',
        message: mod_err.MISSING_MSG
    };

    for (var e in extra) {
        newErr[e] = extra[e];
    }

    return newErr;
}



module.exports = {
    ifErr: ifErr,
    invalidParamErr: invalidParamErr,
    missingParamErr: missingParamErr,
    randomMAC: randomMAC
};
