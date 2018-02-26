/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * OUI/MAC address-related utilities
 */

'use strict';

var mod_mac = require('macaddr');

/**
 * Converts a MAC OUI (eg: '90b8d0') to an integer
 */
function macOUItoNumber(oui) {
    return mod_mac.parse(oui + '000000').toLong();
}

/**
 * Returns the maximum MAC number for the given OUI
 */
function maxOUInumber(oui) {
    var ouiNum = macOUItoNumber(oui);
    return 0xffffff + ouiNum;
}

/**
 * Generates a random MAC number with the given OUI as a prefix.
 */
function randomMACnumber(oui) {
    /*
     * Create a random number between 000000 and ffffff, and add the OUI
     * number to it.
     */
    var ouiNum = macOUItoNumber(oui);
    var random = Math.floor(Math.random() * 0xffffff);
    return ouiNum + random;
}

module.exports = {
    macOUItoNumber: macOUItoNumber,
    maxOUInum: maxOUInumber,
    randomNum: randomMACnumber
};
