/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * nic model: getting
 */

'use strict';

var common = require('./common');
var createFromRaw = require('./obj').createFromRaw;
var mod_moray = require('../../apis/moray');
var validate = require('../../util/validate');

var GET_SCHEMA = {
    required: {
        mac: validate.MAC
    }
};

/**
 * Gets a nic
 */
function get(opts, callback) {
    opts.log.trace('nic.get: entry');

    validate.params(GET_SCHEMA, null, opts.params, function(
        err,
        validatedParams
    ) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(
            opts.app.moray,
            common.BUCKET,
            validatedParams.mac.toString(),
            function(err2, rec) {
                if (err2) {
                    return callback(err2);
                }

                return createFromRaw(opts, rec, callback);
            }
        );
    });
}

module.exports = {
    get: get
};
