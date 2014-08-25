/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
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
function list(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;

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
                // XXX: Don't fetch the network info on every record!
                createFromRaw(opts, rec, function (err2, res2) {
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
