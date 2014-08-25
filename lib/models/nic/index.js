/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * nic model
 */

var common = require('./common');
var mod_moray = require('../../apis/moray');



// --- Exports



/**
 * Initializes the nic tags bucket
 */
function initNicsBucket(app, callback) {
    mod_moray.initBucket(app.moray, common.BUCKET, callback);
}



module.exports = {
    create: require('./create').create,
    del: require('./del').del,
    get: require('./get').get,
    init: initNicsBucket,
    list: require('./list').list,
    update: require('./update').update
};
