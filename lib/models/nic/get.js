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
function get(app, log, params, callback) {
    log.debug(params, 'get:nic: entry');

    validate.params({
        params: params,
        required: {
            mac: common.validateMAC
        }
    }, function (err, validatedParams) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(app.moray, common.BUCKET,
            validatedParams.mac.toString(),
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return createFromRaw(app, log, rec.value, callback);
        });
    });
}



module.exports = {
    get: get
};
