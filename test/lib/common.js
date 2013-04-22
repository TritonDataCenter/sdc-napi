/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Common test helpers shared between integration and unit tests
 */

var assert = require('assert-plus');


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
 * Returns an invalid parameter error body, overriding with fields in
 * extra
 */
function invalidParamErr(extra) {
    assert.optionalObject(extra, 'extra');

    var newErr = {
        code: 'InvalidParameters',
        message: 'Invalid parameters'
    };

    for (var e in extra) {
        newErr[e] = extra[e];
    }

    return newErr;
}



module.exports = {
    invalidParamErr: invalidParamErr,
    randomMAC: randomMAC
};
