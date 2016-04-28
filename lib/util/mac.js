/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * MAC address-related utilities
 */

'use strict';

var NON_HEX_RE = /[^a-fA-F0-9]/g;


/*
 * Convert a colon-separated MAC address to an integer
 */
function macAddressToNumber(addr) {
    if (!addr) {
        return null;
    }

    var num = addr.replace(/[-:]/g, '');
    if (num.length !== 12) {
        return null;
    }
    if (NON_HEX_RE.test(num)) {
        return null;
    }

    num = parseInt(num, 16);
    if (isNaN(num)) {
        return null;
    }
    return num;
}


/*
 * Converts a MAC OUI (eg: '90b8d0') to an integer
 */
function macOUItoNumber(oui) {
    return macAddressToNumber(oui + '000000');
}


/*
 * Converts a MAC integer into a colon-separated MAC address, or returns null
 * if the number can't be converted
 */
function macNumberToAddress(num) {
    // TODO: validate number range here
    if (isNaN(num)) {
        return null;
    }

    // 2^40 = 1099511627776
    var a = Math.floor(num / 1099511627776);
    var aR = num - (a * 1099511627776);
    var aStr = a.toString(16);
    if (aStr.length === 1) {
        aStr = '0' + aStr;
    }

    var b = Math.floor(aR / 4294967296);
    var bR = aR - (b * 4294967296);
    var bStr = b.toString(16);
    if (bStr.length === 1) {
        bStr = '0' + bStr;
    }

    var c = Math.floor(bR / 16777216);
    var cR = bR - (c * 16777216);
    var cStr = c.toString(16);
    if (cStr.length === 1) {
        cStr = '0' + cStr;
    }

    var d = Math.floor(cR / 65536);
    var dR = cR - (d * 65536);
    var dStr = d.toString(16);
    if (dStr.length === 1) {
        dStr = '0' + dStr;
    }

    var e = Math.floor(dR / 256);
    var eR = dR - (e * 256);
    var eStr = e.toString(16);
    if (eStr.length === 1) {
        eStr = '0' + eStr;
    }
    var fStr = eR.toString(16);
    if (fStr.length === 1) {
        fStr = '0' + fStr;
    }

    return aStr + ':' + bStr + ':' + cStr + ':' +
        dStr + ':' + eStr + ':' + fStr;
}


/*
 * Returns the maximum MAC number for the given OUI
 */
function maxOUInumber(oui) {
    var ouiNum = macOUItoNumber(oui);
    return 16777216 + ouiNum;
}


/*
 * Generates a random MAC number with the given OUI as a prefix
 */
function randomMACnumber(oui) {
    var ouiNum = macOUItoNumber(oui);
    // Create a random number between 000000 and ffffff, and add the OUI
    // number to it
    return Math.floor(Math.random() * 16777216) + ouiNum;
}



module.exports = {
    aton: macAddressToNumber,
    macAddressToNumber: macAddressToNumber,
    macOUItoNumber: macOUItoNumber,
    macNumberToAddress: macNumberToAddress,
    maxOUInum: maxOUInumber,
    ntoa: macNumberToAddress,
    randomNum: randomMACnumber
};
