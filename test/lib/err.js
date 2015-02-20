/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Error helpers
 */

var constants = require('../../lib/util/constants');
var errors = require('../../lib/util/errors');
var util = require('util');



// --- Exports



/**
 * Return an error for an overlapping subnet
 */
function subnetOverlapErr(nets) {
    if (!util.isArray(nets)) {
        nets = [ nets ];
    }

    return new errors.InvalidParamsError(constants.msg.INVALID_PARAMS,
        errors.networkOverlapParams(nets)).body;
}


/**
 * Return a "VLAN in use" error
 */
function vlanInUseErr() {
    return new errors.InUseError(constants.msg.VLAN_USED, [
        errors.duplicateParam('vlan_id', constants.msg.VLAN_USED)
    ]).body;
}



module.exports = {
    subnetOverlap: subnetOverlapErr,
    vlanInUse: vlanInUseErr
};
