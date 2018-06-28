/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Common functions shared between fabrics endpoints
 */

'use strict';

var constants = require('../../util/constants');
var mod_restify = require('restify');
var mod_networks_common = require('../networks/common');



// --- Exports



/**
 * Return an error if overlay networking is not enabled.
 */
function ensureOverlaysEnabled(req, res, next) {
    if (!constants.FABRICS_ENABLED) {
        return next(new mod_restify.PreconditionRequiredError(
            constants.msg.OVERLAY_REQUIRED));
    }

    return next();
}



module.exports = {
    ensureOverlaysEnabled: ensureOverlaysEnabled,
    ensureNetworkExists: mod_networks_common.ensureNetworkExists
};
