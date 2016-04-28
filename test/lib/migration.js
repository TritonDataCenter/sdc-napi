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
var config = require('./config');
var fmt = require('util').format;
var log = require('./log');
var mod_moray = require('moray');
var mod_server = require('./server');
var mod_vasync = require('vasync');
var napi_moray = require('../../lib/apis/moray');



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
    if (MORAY_CLIENT) {
        return callback(null, MORAY_CLIENT);
    }

    assert.object(config, 'config');
    assert.object(config.moray, 'config.moray');
    assert.func(callback, 'callback');

    MORAY_CLIENT = mod_moray.createClient({
        host: config.moray.host,
        log: log.child({
            component: 'moray-migrate',
            level: process.env.LOG_LEVEL || 'fatal'
        }),
        port: config.moray.port
    });

    MORAY_CLIENT.once('connect', function _afterConnect() {
        return callback(null, MORAY_CLIENT);
    });
}



// --- Exports



/**
 * Delete all test buckets created
 */
function delAllCreatedBuckets(t) {
    var created = napi_moray.bucketsCreated();
    if (created.length === 0) {
        t.ok(true, 'No buckets created');
        return t.end();
    }

    getMorayClient(function (_, client) {
        mod_vasync.forEachParallel({
            inputs: created,
            func: function _delBucket(bucketName, cb) {
                client.delBucket(bucketName, function (delErr) {
                    t.ifErr(delErr, 'delete bucket ' + bucketName);
                    return cb();
                });
            }
        }, function () {
            return t.end();
        });
    });
}


function delAllPreviousTestBuckets(t) {
    var opts = {
        noBucketCache: true
    };

    getMorayClient(function (_, client) {
        client.listBuckets(opts, function _afterBucketList(lErr, buckets) {
            var matching = [];

            t.ifErr(lErr, 'list buckets');
            if (lErr) {
                return t.end();
            }

            buckets.forEach(function (bucket) {
                if (bucket.name.match(/^test_napi/) ||
                    bucket.name.match(/^test_portolan/)) {
                    matching.push(bucket.name);
                }
            });

            if (matching.length === 0) {
                t.ok(true, 'No previous test buckets found');
                return t.end();
            }

            mod_vasync.forEachParallel({
                inputs: matching,
                func: function _delBucket(bucketName, cb) {
                    client.delBucket(bucketName, function (delErr) {
                        t.ifErr(delErr, 'delete bucket ' + bucketName);
                        return cb();
                    });
                }
            }, function () {
                return t.end();
            });
        });
    });
}


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

    napi_moray.setTestPrefix();
    var bucketName = napi_moray.bucketName(opts.bucket.name);
    var client;
    var origName = opts.bucket.name;

    assert.equal(bucketName, 'test_' + origName, 'bucket has test prefix');

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
                if (delErr && delErr.name === 'BucketNotFoundError') {
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
                t.equal(opts.bucket.name, 'test_' + origName,
                    'prefix added to bucket name');

                return cb(initErr);
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


function runMigrations(t) {
    var server = mod_server.get();
    t.ok(server, 'server');

    if (!server) {
        return t.end();
    }

    server.loadInitialData(function () {
        // We don't really need to do this, but the real NAPI server does
        // it, so we do to be consistent
        log.debug('Initial data loaded');

        server.doMigrations(function _afterMigrations(mErr) {
            t.ifErr(mErr, 'migration err');
            return t.end();
        });
    });
}



module.exports = {
    closeClient: closeClient,
    delAllCreated: delAllCreatedBuckets,
    delAllPrevious: delAllPreviousTestBuckets,
    getMorayObj: getMorayObject,
    initBucket: initTestBucket,
    run: runMigrations
};
