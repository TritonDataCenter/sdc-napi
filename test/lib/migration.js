/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for accessing mock moray data
 */

'use strict';

var assert = require('assert-plus');
var fmt = require('util').format;
var log = require('./log');
var mod_server = require('./server');
var mod_vasync = require('vasync');
var napi_moray = require('../../lib/apis/moray');
var VError = require('verror');



// --- Globals



var MORAY_CLIENT;



// --- Internal



function closeClient(t) {
    if (MORAY_CLIENT) {
        MORAY_CLIENT.close();
        t.ok(true, 'closed client');
    }

    return t.end();
}


function getMorayClient(callback) {
    assert.func(callback, 'callback');

    if (MORAY_CLIENT) {
        callback(null, MORAY_CLIENT);
        return;
    }

    var log_child = log.child({
        component: 'moray-migrate',
        level: process.env.LOG_LEVEL || 'fatal'
    });

    mod_server.setupMoray(log_child, function (err, moray) {
        if (err) {
            callback(err);
            return;
        }

        MORAY_CLIENT = moray;

        callback(null, moray);
    });
}



// --- Exports


/**
 * Get an object from moray
 */
function getMorayObject(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.bucket, 'opts.bucket');
    assert.string(opts.bucket.name, 'opts.bucket.name');
    assert.object(opts.exp, 'opts.exp');
    assert.string(opts.key, 'opts.key');

    var desc = fmt(' %s::%s', opts.bucket.name, opts.key);

    getMorayClient(function (_, client) {
        client.getObject(opts.bucket.name, opts.key, function (err, res) {
            t.ifErr(err, 'getObject' + desc);
            if (err) {
                return t.end();
            }

            t.deepEqual(res.value, opts.exp, 'object' + desc);
            return t.end();
        });
    });
}


/**
 * Create a bucket and populate it with records
 */
function initTestBucket(t, opts) {
    assert.object(t, 't');
    assert.object(opts, 'opts');
    assert.object(opts.bucket, 'opts.bucket');
    assert.string(opts.bucket.name, 'opts.bucket.name');
    assert.optionalArrayOfObject(opts.records, 'opts.records');

    var bucketName = napi_moray.bucketName(opts.bucket.name);
    var client;

    if (opts.records && opts.records.length !== 0) {
        for (var r in opts.records) {
            assert.string(opts.records[r].key, fmt('records[%d].key', r));
            assert.object(opts.records[r].value, fmt('records[%d].value', r));
        }
    }

    mod_vasync.pipeline({
    funcs: [
        function _getClient(_, cb) {
            getMorayClient(function (clErr, cl) {
                client = cl;
                return cb(clErr);
            });
        },

        function _delOldBucket(_, cb) {
            client.delBucket(bucketName, function (delErr) {
                if (delErr &&
                    VError.hasCauseWithName(delErr, 'BucketNotFoundError')) {
                    t.ok(delErr, 'bucket not found: ' + bucketName);
                    return cb();
                }

                t.ifErr(delErr, 'delete bucket ' + bucketName);
                return cb(delErr);
            });
        },

        function _initBucket(_, cb) {
            napi_moray.initBucket(client, opts.bucket,
                    function _afterInit(initErr) {
                t.ifErr(initErr, 'initialize bucket ' + bucketName);
                cb(initErr);
            });
        },

        function _batchCreate(_, cb) {
            var batch = [];
            var batchOpts = {
                noBucketCache: true
            };

            if (!opts.records || opts.records.length === 0) {
                return cb();
            }

            opts.records.forEach(function (rec) {
                batch.push({
                    bucket: bucketName,
                    key: rec.key,
                    operation: 'put',
                    value: rec.value,
                    options: {
                        etag: null
                    }
                });
            });

            client.batch(batch, batchOpts, function (batchErr) {
                t.ifErr(batchErr, 'batch records added to ' + bucketName);

                return cb(batchErr);
            });
        }

    ] }, function (err) {
        t.ifError(err, 'successfully initialized test buckets');
        return t.end();
    });
}


module.exports = {
    closeClient: closeClient,
    getMorayClient: getMorayClient,
    getMorayObj: getMorayObject,
    initBucket: initTestBucket
};
