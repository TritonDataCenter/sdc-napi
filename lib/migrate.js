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
 */

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
 * - `extra` {Object} (optional): extra params to pass to constructors
 * @param callback {Function} `function (err)`
 */
function migrateAll(opts, callback) {
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
 * - `model` {Object}:
 *  - `bucket`: bucket definition for the model
 *  - `constructor`: model constructor
 * - `extra` {Object} (optional): extra parameters to pass to constructor
 * @param callback {Function} `function (err, success)` where success is a
 *  boolean value indicating whether a migration was performed
 */
function migrate(opts, callback) {
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

        var version = (bucketObj.options ? bucketObj.options.version : 0) || 0;

        if (opts.app.morayVersion < bucket.morayVersion) {
            log.info({
                moray: opts.app.morayVersion,
                required: bucket.morayVersion
            }, 'bucket requires newer moray: migration aborted');
            return callback(null, false);
        }

        if (version >= bucket.migrationVersion) {
            log.info({
                version: version,
                migrationVersion: bucket.migrationVersion,
                bucket: bucket.name
            }, 'bucket version OK: migration not required');
            return callback(null, false);
        }

        log.info({
            version: version,
            migrationVersion: bucket.migrationVersion,
            bucket: bucket.name
        }, 'migrating bucket');

        if (opts.app.useStrings && bucket.morayVersion >= 2) {
            extra.use_strings = true;
        }

        updateRecords({
            bucket: bucket,
            extra: extra,
            log: log,
            model: model,
            moray: moray
        }, function (recordsErr) {
            if (recordsErr) {
                return callback(recordsErr);
            }

            updateBucket({
                bucket: bucket,
                log: log,
                moray: moray
            }, function (bucketErr) {
                if (bucketErr) {
                    return callback(bucketErr);
                }

                return callback(null, true);
            });
        });
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
            moray: moray
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

            log.info({ processed: processed, cur: batch.length },
                'Migrating records');
            log.debug({ batch: batch }, 'migrate: batch');

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
                log.info({ processed: processed, cur: batch.length },
                    'Migrated records');

                // Migration succeeded - keep going
                return next(null, null, true);
            });
        });
    }, function (afterErr) {
        if (afterErr) {
            return callback(afterErr);
        }

        log.info({
            oldVersion: version,
            version: bucket.migrationVersion,
            processed: processed
        }, 'All pending records migrated');

        return callback();
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
            old: version,
            version: bucket.migrationVersion
        }, 'bucket migration complete');

        return callback();
    });
}


module.exports = {
    migrate: migrate,
    migrateAll: migrateAll
};
