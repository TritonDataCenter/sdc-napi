/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
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
