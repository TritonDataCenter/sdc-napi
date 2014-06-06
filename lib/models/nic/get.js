/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: getting
 */

var common = require('./common');
var createFromRaw = require('./obj').createFromRaw;
var mod_moray = require('../../apis/moray');
var validate = require('../../util/validate');
var vasync = require('vasync');



/**
 * Gets a nic
 */
function get(opts, callback) {
    opts.log.trace('nic.get: entry');

    validate.params({
        params: opts.params,
        required: {
            mac: common.validateMAC
        }
    }, function (err, validatedParams) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(opts.app.moray, common.BUCKET,
            validatedParams.mac.toString(),
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return createFromRaw(opts, rec, callback);
        });
    });
}



module.exports = {
    get: get
};
