/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model
 */

'use strict';

var common = require('./common');
var mod_moray = require('../../apis/moray');
var mod_portolan_moray = require('portolan-moray');
var mod_vasync = require('vasync');



// --- Exports



/**
 * Initializes the nics bucket and all of the portolan buckets
 */
function initNicsBucket(app, callback) {
    mod_moray.initBucket(app.moray, common.BUCKET, function _afterInit(err) {
        if (err) {
            return callback(err);
        }

        mod_vasync.forEachParallel({
            inputs: Object.keys(mod_portolan_moray.buckets).map(function (b) {
                return mod_portolan_moray.buckets[b];
            }),
            func: function _initPortolanBucket(bucket, cb) {
                return mod_moray.initBucket(app.moray, bucket, cb);
            }
        }, callback);
    });
}



module.exports = {
    bucket: function () { return common.BUCKET; },
    create: require('./create').create,
    del: require('./del').del,
    get: require('./get').get,
    init: initNicsBucket,
    list: require('./list').list,
    Nic: require('./obj').Nic,
    update: require('./update').update
};
