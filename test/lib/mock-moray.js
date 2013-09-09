/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Mock moray object for unit tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var util = require('util');
var verror = require('verror');



// --- Globals



var BUCKETS = {};
var MORAY_ERRORS = {};



// --- Internal



/**
 * If there's an error in MORAY_ERRORS for the given operation, return it.
 */
function getNextMorayError(op) {
    if (!MORAY_ERRORS.hasOwnProperty(op) ||
        typeof (MORAY_ERRORS[op]) !== 'object' ||
        MORAY_ERRORS.length === 0) {
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

    this.log = opts.log;
    BUCKETS = {};
    EventEmitter.call(this);
}

util.inherits(FakeMoray, EventEmitter);


FakeMoray.prototype._put = function _store(bucket, key, val) {
    BUCKETS[bucket][key] = clone(val);
};


FakeMoray.prototype._del = function _del(bucket, key) {
    var err = getNextMorayError('delObject');
    if (err) {
        throw err;
    }

    if (!BUCKETS.hasOwnProperty(bucket)) {
        throw bucketNotFoundErr(bucket);
    }

    if (!BUCKETS[bucket].hasOwnProperty(key)) {
        throw objectNotFoundErr(key);
    }

    delete BUCKETS[bucket][key];
};


FakeMoray.prototype.batch = function batch(data, callback) {
    assert.arrayOfObject(data, 'data');

    var err = getNextMorayError('batch');
    if (err) {
        return callback(err);
    }

    for (var b in data) {
        var item = data[b];
        assert.string(item.bucket, 'item.bucket');
        assert.string(item.key, 'item.key');
        assert.string(item.operation, 'item.operation');

        if (item.operation === 'put') {
            assert.object(item.value, 'item.value');
            if (!BUCKETS.hasOwnProperty(item.bucket)) {
                return callback(bucketNotFoundErr(item.bucket));
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
    }

    return callback();
};


FakeMoray.prototype.createBucket =
    function createBucket(bucket, schema, callback) {

    var err = getNextMorayError('createBucket');
    if (err) {
        return callback(err);
    }

    BUCKETS[bucket] = {};
    return callback();
};


FakeMoray.prototype.delBucket = function delBucket(bucket, callback) {
    var err = getNextMorayError('delBucket');
    if (err) {
        return callback(err);
    }

    if (!BUCKETS.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    delete BUCKETS[bucket];
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

        if (!BUCKETS.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        for (var r in BUCKETS[bucket]) {
            // The LDAP matching function .matches() assumes that the
            // values are strings, so stringify properties so that matches
            // work correctly
            var obj = {};
            for (var k in BUCKETS[bucket][r]) {
                obj[k] = BUCKETS[bucket][r][k].toString();
            }

            if (filterObj.matches(obj)) {
                res.emit('record', { value: clone(BUCKETS[bucket][r]) });
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

    // The real moray returns the bucket schema here, but NAPI only
    // uses this for an existence check, so this suffices
    return callback(null, BUCKETS[bucket]);
};


FakeMoray.prototype.getObject = function getObject(bucket, key, callback) {
    var err = getNextMorayError('getObject');
    if (err) {
        return callback(err);
    }

    if (!BUCKETS.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    if (!BUCKETS[bucket].hasOwnProperty(key)) {
        return callback(objectNotFoundErr(key));
    }

    return callback(null, { value: clone(BUCKETS[bucket][key]) });
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

    if (!BUCKETS.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
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

        if (!BUCKETS.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        var bucketKeys = Object.keys(BUCKETS[bucket]).map(function (k) {
            return Number(k); }).sort();
        var last = bucketKeys[0];

        for (var i in bucketKeys) {
            var ip = bucketKeys[i];
            if ((ip - last) > 1 && (last + 1) <= lt && (last + 1) >= gt) {
                res.emit('record', { gap_start: last + 1 });
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

    return callback(new Error('FakeMoray: not implemented'));
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
    get _buckets() {
        return BUCKETS;
    },
    set _errors(obj) {
        MORAY_ERRORS = obj;
    },
    FakeMoray: FakeMoray,
    createClient: createClient
};
