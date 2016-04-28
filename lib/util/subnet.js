/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Subnet-related utilities
 */

'use strict';

var constants = require('./constants');
var util = require('util');
var util_ip = require('./ip');


function fromNumberArray(subnetTxt) {
    var subnet = subnetTxt.split('/');

    if (subnet.length !== 2) {
        return null;
    }

    var startIP = util_ip.ntoa(subnet[0]);
    var bits = Number(subnet[1]);

    if (startIP === null) {
        return null;
    }

    if (isNaN(bits) || (bits < constants.SUBNET_MIN) || (bits > 32)) {
        return null;
    }

    return util.format('%s/%d', startIP, bits);
}


function toNumberArray(subnetTxt) {
    var subnet = subnetTxt.split('/');

    if (subnet.length !== 2) {
        return null;
    }

    var startIP = util_ip.toIPAddr(subnet[0]);
    var bits = Number(subnet[1]);

    if (startIP === null) {
        return null;
    }

    var minBits = startIP.kind() === 'ipv4' ? constants.SUBNET_MIN_IPV4 :
        constants.SUBNET_MIN_IPV6;

    if (isNaN(bits) || (bits < minBits) || (bits > 32)) {
        return null;
    }

    return [startIP, bits];
}



module.exports = {
    fromNumberArray: fromNumberArray,
    toNumberArray: toNumberArray
};
