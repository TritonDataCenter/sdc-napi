/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Bucket migration functions
 *
 * Migration of the records is performed by constructing the corresponding
 * model using the existing parameters stored in moray, then calling `raw()` to
 * get the new record to put into moray. Since migration only uses the new model
 * to construct new instances, you must be able to create new, valid records
 * from the parameters in the old records.
 *
 *
 * Migrating a bucket involves the following steps:
 * 1. Check and update bucket schema and version, if needed.
 * 2. Re-index objects.
 * 3. Re-put objects.
 *
 * Every step happens for each bucket every time NAPI starts. Since NAPI could
 * have crashed during re-indexing or re-putting, we run both each time to check
 * for any records that still need to be processed.
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var mod_moray = require('./apis/moray');
var util_common = require('./util/common');
var util = require('util');
var vasync = require('vasync');
var VError = require('verror').VError;


/**
 * Migrates records in the buckets for each of the provided models.
 *
 * @param opts {Object}:
 * - `app` {App}
 * - `log` {Bunyan logger}
 * - `models` {Array}: array of {constructor, bucket} for each model
 *  e.g. [ {constructor: mod_ip.IP, bucket: mod_ip.bucket()} ]
 * - `extra` {Object} (optional): extra params to pass to constructors
 * @param callback {Function} `function (err)`
 */
function migrateAll(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.app, 'opts.app');
    assert.object(opts.log, 'opts.log');
    assert.arrayOfObject(opts.models, 'opts.models');
    assert.optionalObject(opts.extra, 'opts.extra');
    assert.func(callback, 'callback');

    var app = opts.app;
    var log = opts.log;
    var models = opts.models;
    var extra = opts.extra;

    // Check if any migrations require a newer moray. We throw here because
    // changes that depend on new features of moray are generally not backwards
    // compatible in NAPI. Use `migrate` to migrate a single bucket without
    // throwing.
    models.forEach(function (model) {
        if (model.bucket.hasOwnProperty('morayVersion') &&
            model.bucket.morayVersion > app.morayVersion) {

            throw new VError('moray is at version %d but bucket ' +
                '%s requires moray version %d',
                app.morayVersion,
                model.bucket.name,
                model.bucket.morayVersion);
        }
    });

    vasync.forEachPipeline({
        func: function migrateOne(model, cb) {
            migrate({
                extra: extra,
                log: log,
                model: model.constructor,
                moray: app.moray,
                bucket: model.bucket
            }, cb);
        },
        inputs: models
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        log.debug(res, 'migration results');

        return callback();
    });
}



/**
 * Migrates records in the buckets for each of the provided models.
 *
 * @param opts {Object]:
 * - `moray`: {Moray Client}
 * - `bucket` {Object}: bucket definition
 * - `log` {Bunyan logger}
 * - `model` {Function}: model constructor
 * - `extra` {Object} (optional): extra parameters to pass to constructor
 * @param callback {Function} `function (err, success)` where success is a
 *  boolean value indicating whether a migration was performed
 */
function migrate(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.moray, 'opts.moray');
    assert.object(opts.bucket, 'opts.bucket');
    assert.object(opts.log, 'opts.log');
    assert.func(opts.model, 'opts.model');
    assert.optionalObject(opts.extra, 'opts.extra');
    assert.func(callback, 'callback');

    var bucket = opts.bucket;
    var log = opts.log;
    var model = opts.model;
    var moray = opts.moray;
    var extra = opts.extra || {};

    if (!bucket.version) {
        return setImmediate(function () {
            log.info({
                bucket: bucket.name
            }, 'bucket migration not required');
            return callback(null, false);
        });
    }

    log.info('begin migration for bucket %s', bucket.name);
    vasync.pipeline({
        funcs: [ updateBucket, reindex, updateRecords ],
        arg: {
            bucket: bucket,
            extra: extra,
            log: log,
            model: model,
            moray: moray
        }
    }, function (err, res) {
        if (err) {
            return callback(err);
        }
        log.trace({ bucket: bucket.name, res: res }, 'migration complete');
        log.info('end migration for bucket %s', bucket.name);
        return callback();
    });
}



function updateBucket(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    moray.getBucket(bucket.name, function (err, bucketObj) {
        if (err) {
            return callback(err);
        }

        var version = (bucketObj.options ? bucketObj.options.version : 0) || 0;

        if (bucket.version <= version) {
            log.info({
                bucket: bucket.name,
                existing: version,
                current: bucket.version
            }, 'updateBucket: bucket up to date');
            return callback();
        }

        log.info({
            existing: bucketObj,
            current: bucket
        }, 'updateBucket: updating bucket');

        var schema = clone(bucket.schema);
        schema.options = schema.options || {};
        schema.options.version = bucket.version;

        moray.updateBucket(bucket.name, schema, function (uErr) {
            if (uErr) {
                return callback(uErr);
            }

            log.info({
                bucket: bucket.name,
                old: version,
                current: bucket.version
            }, 'updateBucket: bucket updated');

            return callback();
        });

    });
}



function reindex(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    var processed = 0;
    var count = 100;

    var options = {
        noBucketCache: true
    };

    util_common.repeat(function _index(next) {
        moray.reindexObjects(bucket.name, count, options, function (err, res) {
            if (err) {
                return next(err, null, false);
            }

            if (res.processed > 0) {
                log.info({
                    bucket: bucket.name,
                    processed: processed,
                    cur: res.processed
                }, 'reindex: records reindexed');

                processed += res.processed;
                return next(null, null, true);
            }

            return next(null, null, false);
        });
    }, function (afterErr) {
        if (afterErr) {
            return callback(afterErr);
        }

        if (processed === 0) {
            log.info({
                bucket: bucket.name
            }, 'reindex: records already reindexed');
        } else {
            log.info({
                bucket: bucket.name
            }, 'reindex: all records reindexed');
        }
        return callback();
    });
}



function updateRecords(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var model = opts.model;
    var moray = opts.moray;
    var extra = opts.extra;

    var processed = 0;

    if (!bucket.schema.index.hasOwnProperty('v')) {
        log.info('updateRecords: records not versioned. aborting.');
        return setImmediate(function () {
            return callback();
        });
    }

    util_common.repeat(function _processBatch(next) {
        mod_moray.listObjs({
            extra: extra,
            filter: util.format('(|(!(v=*))(v<=%d))', bucket.version - 1),
            log: opts.log,
            bucket: bucket,
            model: model,
            moray: moray,
            noBucketCache: true
        }, function (listErr, recs) {
            if (listErr) {
                return next(listErr, null, false);
            }

            if (recs.length === 0) {
                // No more unmigrated records
                return next(null, null, false);
            }

            var batch = [];
            recs.forEach(function (r) {
                var b = r.batch({ migration: true });
                if (Array.isArray(b)) {
                    Array.prototype.push.apply(batch, b);
                } else {
                    batch.push(b);
                }
            });

            log.debug({
                batch: batch,
                bucket: bucket.name
            }, 'updateRecords: batch');

            moray.batch(batch, function (batchErr) {
                if (batchErr) {
                    if (batchErr.name === 'EtagConflictError') {
                        // One of the batch objects has been updated from
                        // under us: try it again next time
                        return next(batchErr, null, true);
                    }

                    return next(batchErr, null, false);
                }

                processed += batch.length;
                log.info({
                    bucket: bucket.name,
                    processed: processed,
                    cur: batch.length
                }, 'updateRecords: records migrated');

                // Migration succeeded - keep going
                return next(null, null, true);
            });
        });
    }, function (afterErr) {
        if (afterErr) {
            return callback(afterErr);
        }

        if (processed === 0) {
            log.info({
                bucket: bucket.name
            }, 'updateRecords: records already migrated');
        } else {
            log.info({
                bucket: bucket.name,
                version: bucket.version,
                processed: processed
            }, 'updateRecords: all records migrated');
        }

        return callback();
    });
}



module.exports = {
    migrate: migrate,
    migrateAll: migrateAll
};
