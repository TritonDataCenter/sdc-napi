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
 * 1. Update the bucket schema.
 * 2. Re-put all records in the bucket using the raw form of the new model.
 * 3. Re-index objects.
 * 4. Update the bucket migration version.
 *
 * There are two bucket versions, `version` and `migrationVersion`. These are
 * used to make sure migration is completed successfully even if NAPI crashes
 * during migrations.
 *
 * The `version` field is the bucket schema version. This is incremented when
 * we call `updateBucket`. It's also used by moray to make sure a bucket is
 * always updated to a higher version.
 *
 * `migrationVersion` is used to track the version of the records in the
 * bucket. Once all the records in the bucket have been re-put and re-indexed,
 * migrationVersion is incremented to indicate that the bucket has been
 * migrated to that version.
 */

var assert = require('assert-plus');
var clone = require('clone');
var mod_moray = require('./apis/moray');
var util_common = require('./util/common');
var util = require('util');
var vasync = require('vasync');


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

            throw new Error(util.format('moray is at version %d but bucket ' +
                '%s requires moray version %d',
                app.morayVersion,
                model.bucket.name,
                model.bucket.morayVersion));
        }
    });

    vasync.forEachParallel({
        func: function migrateOne(model, cb) {
            migrate({
                app: app,
                extra: extra,
                log: log,
                model: model.constructor,
                bucket: model.bucket
            }, cb);
        },
        inputs: models
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        log.debug(res, 'migration results');
        log.info('migrations complete');

        return callback();
    });
}



/**
 * Migrates records in the buckets for each of the provided models.
 *
 * @param opts {Object]:
 * - `app`: {App}
 * - `bucket` {Object}: bucket definition
 * - `log` {Bunyan logger}
 * - `model` {Function}: model constructor
 * - `extra` {Object} (optional): extra parameters to pass to constructor
 * @param callback {Function} `function (err, success)` where success is a
 *  boolean value indicating whether a migration was performed
 */
function migrate(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.app, 'opts.app');
    assert.object(opts.bucket, 'opts.bucket');
    assert.object(opts.log, 'opts.log');
    assert.func(opts.model, 'opts.model');
    assert.optionalObject(opts.extra, 'opts.extra');
    assert.func(callback, 'callback');

    var bucket = opts.bucket;
    var log = opts.log;
    var model = opts.model;
    var moray = opts.app.moray;
    var extra = opts.extra || {};

    if (!bucket.migrationVersion) {
        return setImmediate(function () {
            log.info({
                bucket: bucket.name
            }, 'bucket migration not required');
            return callback(null, false);
        });
    }

    moray.getBucket(bucket.name, function (getErr, bucketObj) {
        if (getErr) {
            return callback(getErr);
        }

        var migrationVersion = (bucketObj.options ?
            bucketObj.options.migrationVersion : 0) || 0;

        if (opts.app.morayVersion < bucket.morayVersion) {
            log.info({
                bucket: bucket.name,
                moray: opts.app.morayVersion,
                required: bucket.morayVersion
            }, 'bucket requires newer moray: migration aborted');
            return callback(null, false);
        }

        if (migrationVersion >= bucket.migrationVersion) {
            log.info({
                bucket: bucket.name,
                newVersion: bucket.migrationVersion,
                oldVersion: migrationVersion
            }, 'bucket version OK: migration not required');
            return callback(null, false);
        }

        log.info({
            bucket: bucket.name,
            newVersion: bucket.migrationVersion,
            oldVersion: migrationVersion
        }, 'migrating bucket');

        if (opts.app.useStrings && bucket.morayVersion >= 2) {
            extra.use_strings = true;
        }

        vasync.pipeline({
            funcs: [updateBucket, updateRecords, reindex, updateBucketVersion],
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
            log.trace({bucket: bucket.name, res: res}, 'migration complete');
            return callback();
        });
    });
}



function updateBucket(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    var version = (bucket.options ? bucket.options.version : 0) || 0;

    var schema = clone(bucket.schema);
    schema.options = schema.options || {};
    schema.options.version = bucket.migrationVersion;

    moray.updateBucket(bucket.name, schema, function (uErr) {
        if (uErr) {
            return callback(uErr);
        }
        log.info({
            bucket: bucket.name,
            old: version,
            version: bucket.migrationVersion
        }, 'bucket schema updated');

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
    var version = (bucket.options ? bucket.options.version : 0) || 0;

    util_common.repeat(function _processBatch(next) {
        mod_moray.listObjs({
            extra: extra,
            filter: util.format('(|(!(v=*))(v<=%d))',
                bucket.migrationVersion - 1),
            log: opts.log,
            bucket: bucket,
            model: model,
            moray: moray,
            noBucketCache: true
        }, function (listErr, nets) {
            if (listErr) {
                return next(listErr, null, false);
            }

            if (nets.length === 0) {
                // No more unmigrated networks
                return next(null, null, false);
            }

            var batch = nets.map(function (n) {
                return n.batch();
            });

            log.info({
                bucket: bucket.name,
                processed: processed,
                cur: batch.length
            }, 'Migrating records');

            log.debug({
                batch: batch,
                bucket: bucket.name
            }, 'migrate: batch');

            moray.batch(batch, function (batchErr) {
                if (batchErr) {
                    if (batchErr.name === 'EtagConflictError') {
                        // One of the networks has been updated from under
                        // us: try it again next time
                        return next(batchErr, null, true);
                    }

                    return next(batchErr, null, false);
                }

                processed += batch.length;
                log.info({
                    bucket: bucket.name,
                    processed: processed,
                    cur: batch.length
                }, 'Migrated records');

                // Migration succeeded - keep going
                return next(null, null, true);
            });
        });
    }, function (afterErr) {
        if (afterErr) {
            return callback(afterErr);
        }

        log.info({
            bucket: bucket.name,
            oldVersion: version,
            version: bucket.migrationVersion,
            processed: processed
        }, 'All pending records migrated');

        return callback();
    });
}



function reindex(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    var count = 100;

    var options = {
        noBucketCache: true
    };

    util_common.repeat(function _index(next) {
        moray.reindexObjects(bucket.name, count, options, function (err, res) {
            if (err) {
                return next(err, null, false);
            }

            log.info({
                bucket: bucket.name,
                processed: res.processed,
                remaining: res.remaining
            }, 'records reindexed');

            if (res.processed > 0) {
                return next(null, null, true);
            }
            return next(null, null, false);
        });
    }, function (afterErr) {
        if (afterErr) {
            return callback(afterErr);
        }

        log.info({
            bucket: bucket.name
        }, 'All records reindexed');
    });
}



function updateBucketVersion(opts, callback) {
    var bucket = opts.bucket;
    var log = opts.log;
    var moray = opts.moray;

    var version = (bucket.options ? bucket.options.migrationVersion : 0) || 0;

    var schema = clone(bucket.schema);
    schema.options = schema.options || {};
    schema.options.migrationVersion = bucket.migrationVersion;

    moray.updateBucket(bucket.name, schema, function (uErr) {
        if (uErr) {
            return callback(uErr);
        }
        log.info({
            bucket: bucket.name,
            old: version,
            version: bucket.migrationVersion
        }, 'bucket migration version updated');

        return callback();
    });
}



module.exports = {
    migrate: migrate,
    migrateAll: migrateAll
};
