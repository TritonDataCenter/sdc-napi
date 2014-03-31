/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: listing
 */

var clone = require('clone');
var common = require('./common');
var createFromRaw = require('./obj').createFromRaw;
var mod_moray = require('../../apis/moray');
var util = require('util');
var util_common = require('../../util/common');
var vasync = require('vasync');



// --- Exports



/**
 * Lists nics
 */
function list(app, log, params, callback) {
    log.debug(params, 'nic: list: entry');
    var nics = [];

    var filter = clone(params);
    if (filter.hasOwnProperty('nic_tags_provided')) {
        filter.nic_tags_provided =
            util_common.arrayify(filter.nic_tags_provided).map(function (nt) {
                return util.format('*,%s,*', nt);
        });
    }

    mod_moray.listObjs({
        defaultFilter: '(mac=*)',
        filter: filter,
        log: log,
        bucket: common.BUCKET,
        moray: app.moray,
        sort: {
            attribute: 'mac',
            order: 'ASC'
        }
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        if (!res || res.length === 0) {
            return callback(null, []);
        }

        vasync.forEachParallel({
            inputs: res,
            func: function _listCreate(rec, cb) {
                createFromRaw(app, log, rec.value, function (err2, res2) {
                    if (err2) {
                        return cb(err2);
                    }

                    nics.push(res2);
                    return cb();
                });
            }
        }, function (err3) {
            if (err3) {
                return callback(err3);
            }

            return callback(null, nics);
        });
    });
}



module.exports = {
    list: list
};
