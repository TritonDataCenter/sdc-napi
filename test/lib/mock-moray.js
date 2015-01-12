/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Mock moray object for unit tests
 */

var assert = require('assert-plus');
var crc = require('crc');
var clone = require('clone');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var util = require('util');
var verror = require('verror');



// --- Globals



var BUCKETS = {};
var BUCKET_VALUES = {};
var MORAY_ERRORS = {};



// --- Internal



/**
 * If there's an error in MORAY_ERRORS for the given operation, return it.
 */
function getNextMorayError(op) {
    if (!MORAY_ERRORS.hasOwnProperty(op) ||
        typeof (MORAY_ERRORS[op]) !== 'object' ||
        MORAY_ERRORS[op].length === 0) {
        return;
    }

    return MORAY_ERRORS[op].shift();
}


/**
 * Returns a not found error for the bucket
 */
function bucketNotFoundErr(bucket) {
    var err = new verror.VError('bucket "%s" does not exist', bucket);
    err.name = 'BucketNotFoundError';
    return err;
}


/**
 * Do etag checks on a record
 */
function checkEtag(opts, bucket, key, batch) {
    if (!opts || !opts.hasOwnProperty('etag')) {
        return;
    }

    var errOpts = {};
    if (batch) {
        errOpts = {
            context: {
                bucket: bucket
            }
        };
    }

    if (BUCKET_VALUES[bucket].hasOwnProperty(key)) {
        if (opts.etag === null) {
            throw etagConflictErr(util.format('key "%s" already exists', key),
                errOpts);
        }

        var obj = BUCKET_VALUES[bucket][key];
        if (opts.etag != obj._etag) {
            throw etagConflictErr(
                util.format('wanted to put etag "%s", but object has etag "%s"',
                    opts.etag, obj._etag), errOpts);
        }
    }
}


/**
 * Generates an etag for an object
 */
function eTag(val) {
    return (crc.hex32(crc.crc32(JSON.stringify(val))));
}


/**
 * Returns a not found error for the bucket
 */
function etagConflictErr(msg, otherOpts) {
    var err = new verror.VError(msg);
    err.name = 'EtagConflictError';

    if (otherOpts) {
        for (var o in otherOpts) {
            err[o] = otherOpts[o];
        }
    }

    return err;
}


/**
 * Returns an object not found error
 */
function objectNotFoundErr(key) {
    var err = new verror.VError('key "%s" does not exist', key);
    err.name = 'ObjectNotFoundError';
    return err;
}



// --- Fake moray object



function FakeMoray(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');

    this.log = opts.log.child({ component: 'mock-moray' });
    BUCKET_VALUES = {};
    EventEmitter.call(this);
}

util.inherits(FakeMoray, EventEmitter);


FakeMoray.prototype._del = function _del(bucket, key) {
    var err = getNextMorayError('delObject');
    if (err) {
        throw err;
    }

    if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
        throw bucketNotFoundErr(bucket);
    }

    if (!BUCKET_VALUES[bucket].hasOwnProperty(key)) {
        throw objectNotFoundErr(key);
    }

    delete BUCKET_VALUES[bucket][key];
};


FakeMoray.prototype._put = function _store(bucket, key, val) {
    var obj = {
        _etag: eTag(val),
        key: key,
        value: clone(val)
    };

    this.log.trace({ bucket: bucket, obj: obj }, '_put object');
    BUCKET_VALUES[bucket][key] = obj;
};


FakeMoray.prototype._updateObjects =
    function _updateObjects(bucket, fields, filter) {
    assert.object(fields, 'fields');
    assert.string(filter, 'filter');

    // XXX: should throw if trying to set a non-indexed field

    var filterObj = ldapjs.parseFilter(filter);
    for (var r in BUCKET_VALUES[bucket]) {
        // The LDAP matching function .matches() assumes that the
        // values are strings, so stringify properties so that matches
        // work correctly
        var obj = {};
        for (var k in BUCKET_VALUES[bucket][r].value) {
            obj[k] = BUCKET_VALUES[bucket][r].value[k].toString();
        }

        if (filterObj.matches(obj)) {
            for (var nk in fields) {
                BUCKET_VALUES[bucket][r].value[nk] = fields[nk];
            }
        }
    }
};




FakeMoray.prototype.batch = function _batch(data, callback) {
    assert.arrayOfObject(data, 'data');

    var err = getNextMorayError('batch');
    if (err) {
        return callback(err);
    }

    for (var b in data) {
        var item = data[b];
        assert.string(item.operation, 'item.operation');
        assert.string(item.bucket, 'item.bucket');

        var knownOp = false;
        ['delete', 'put', 'update'].forEach(function (opt) {
            if (item.operation == opt) {
                knownOp = true;
            }
        });

        if (!knownOp) {
            throw new verror.VError('Unknown moray operation "%s"',
                item.operation);
        }

        if (item.operation !== 'update') {
            assert.string(item.key, 'item.key');
        }

        if (item.operation === 'put') {
            assert.object(item.value, 'item.value');
            if (!BUCKET_VALUES.hasOwnProperty(item.bucket)) {
                return callback(bucketNotFoundErr(item.bucket));
            }

            try {
                checkEtag(item.options, item.bucket, item.key, true);
            } catch (eTagErr) {
                return callback(eTagErr);
            }

            this._put(item.bucket, item.key, item.value);
        }

        if (item.operation === 'delete') {
            try {
                this._del(item.bucket, item.key);
            } catch (err2) {
                return callback(err2);
            }
        }

        if (item.operation === 'update') {
            if (!BUCKET_VALUES.hasOwnProperty(item.bucket)) {
                return callback(bucketNotFoundErr(item.bucket));
            }

            this._updateObjects(item.bucket, item.fields, item.filter);
        }
    }

    return callback();
};


FakeMoray.prototype.createBucket =
    function createBucket(bucket, schema, callback) {

    var err = getNextMorayError('createBucket');
    if (err) {
        return callback(err);
    }

    BUCKETS[bucket] = clone(schema);
    BUCKET_VALUES[bucket] = {};
    return callback();
};


FakeMoray.prototype.delBucket = function delBucket(bucket, callback) {
    var err = getNextMorayError('delBucket');
    if (err) {
        return callback(err);
    }

    if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    delete BUCKET_VALUES[bucket];
    return callback();
};


FakeMoray.prototype.delObject = function delObject(bucket, key, callback) {
    try {
        this._del(bucket, key);
        return callback();
    } catch (err) {
        return callback(err);
    }
};


FakeMoray.prototype.findObjects = function findObjects(bucket, filter, opts) {
    var res = new EventEmitter;
    var filterObj = ldapjs.parseFilter(filter);

    process.nextTick(function () {
        var err = getNextMorayError('findObjects');
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        for (var r in BUCKET_VALUES[bucket]) {
            // The LDAP matching function .matches() assumes that the
            // values are strings, so stringify properties so that matches
            // work correctly
            var obj = {};
            for (var k in BUCKET_VALUES[bucket][r].value) {
                obj[k] = BUCKET_VALUES[bucket][r].value[k].toString();
            }

            if (filterObj.matches(obj)) {
                res.emit('record', clone(BUCKET_VALUES[bucket][r]));
            }
        }

        res.emit('end');
    });

    return res;
};


FakeMoray.prototype.getBucket = function getBucket(bucket, callback) {
    var err = getNextMorayError('getBucket');
    if (err) {
        return callback(err);
    }

    if (!BUCKETS.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    return callback(null, clone(BUCKETS[bucket]));
};


FakeMoray.prototype.getObject = function getObject(bucket, key, callback) {
    var err = getNextMorayError('getObject');
    if (err) {
        return callback(err);
    }

    if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    if (!BUCKET_VALUES[bucket].hasOwnProperty(key)) {
        return callback(objectNotFoundErr(key));
    }

    var rec = clone(BUCKET_VALUES[bucket][key]);
    this.log.trace({ bucket: bucket, key: key, rec: rec }, 'got object');
    return callback(null, rec);
};


FakeMoray.prototype.putObject =
    function putObject(bucket, key, value, opts, callback) {
    if (typeof (opts) === 'function') {
        callback = opts;
        opts = {};
    }

    var err = getNextMorayError('putObject');
    if (err) {
        return callback(err);
    }

    if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    try {
        checkEtag(opts, bucket, key);
    } catch (eTagErr) {
        return callback(eTagErr);
    }

    this._put(bucket, key, value);
    return callback();
};


FakeMoray.prototype.sql = function sql(str) {
    // Mock out PG's gap detection

    /* JSSTYLED */
    var bucket = str.match(/from ([a-z0-9_]+)/)[1];
    /* JSSTYLED */
    var gt = Number(str.match(/>= (\d+)/)[1]);
    /* JSSTYLED */
    var limit = Number(str.match(/limit (\d+)/)[1]);
    /* JSSTYLED */
    var lt = Number(str.match(/<= (\d+)/)[1]);
    var res = new EventEmitter;

    assert.string(bucket, 'bucket');
    assert.number(gt, 'gt');
    assert.number(lt, 'lt');

    process.nextTick(function () {
        var err = getNextMorayError('sql');
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        var bucketKeys = Object.keys(BUCKET_VALUES[bucket]).map(function (k) {
            return Number(k); }).sort();
        var found = 0;
        var last = bucketKeys[0];

        for (var i in bucketKeys) {
            var ip = bucketKeys[i];
            if ((ip - last) > 1 && (last + 1) <= lt && (last + 1) >= gt) {
                if (limit && found < limit) {
                    res.emit('record', {
                        // XXX: is this right?
                        gap_length: ip - last + 1,
                        gap_start: last + 1
                    });
                }
                found++;
                break;
            }
            last = ip;
        }

        res.emit('end');
    });

    return res;
};


FakeMoray.prototype.updateBucket =
    function updateBucket(bucket, schema, callback) {

    BUCKETS[bucket] = clone(schema);
    return callback();
};



FakeMoray.prototype.updateObjects =
    function updateObjects(bucket, fields, filter, callback) {
    assert.object(bucket, 'bucket');

    if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    this._updateObjects(bucket, fields, filter);
    return callback();
};



// --- Exports



function createClient(opts) {
    var client = new FakeMoray(opts);
    process.nextTick(function () {
        client.emit('connect');
    });

    return client;
}



module.exports = {
    get _bucketSchemas() {
        return BUCKETS;
    },
    get _buckets() {
        return BUCKET_VALUES;
    },
    get _errors() {
        return MORAY_ERRORS;
    },
    set _errors(obj) {
        MORAY_ERRORS = obj;
    },
    FakeMoray: FakeMoray,
    createClient: createClient
};
