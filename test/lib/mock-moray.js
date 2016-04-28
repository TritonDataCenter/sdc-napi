/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Mock moray object for unit tests
 */

'use strict';

var assert = require('assert-plus');
var crc = require('crc');
var clone = require('clone');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var util = require('util');
var util_ip = require('../../lib/util/ip.js');
var verror = require('verror');



// --- Globals



var BUCKETS = {};
var BUCKET_VALUES = {};
var LAST_MORAY_ERROR;
var MORAY_ERRORS = {};



// --- Internal



/**
 * If there's an error in MORAY_ERRORS for the given operation, return it.
 */
function getNextMorayError(op, details) {
    if (!MORAY_ERRORS.hasOwnProperty(op) ||
        typeof (MORAY_ERRORS[op]) !== 'object' ||
        MORAY_ERRORS[op].length === 0) {
        return;
    }

    var morayErr = MORAY_ERRORS[op].shift();

    // Allow passing null in the array to allow interleaving successes and
    // errors
    if (morayErr === null) {
        return;
    }

    LAST_MORAY_ERROR = clone(details);
    LAST_MORAY_ERROR.op = op;
    LAST_MORAY_ERROR.msg = morayErr.message;

    return morayErr;
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
        if (opts.etag !== obj._etag) {
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


function matchObj(filter, origObj) {
    // The LDAP matching function .matches() assumes that the
    // values are strings, so stringify properties so that matches
    // work correctly.  The exception is arrays - it's able to walk
    // an array and match each element individually.
    var obj = {};
    for (var k in origObj.value) {
        var val = origObj.value[k];
        if (util.isArray(val)) {
            obj[k] = clone(origObj.value[k]);
        } else {
            obj[k] = origObj.value[k].toString();
        }
    }

    if (filter.matches(obj)) {
        return true;
    }

    return false;
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
    this._version = opts.version || 2;
    BUCKET_VALUES = {};
    EventEmitter.call(this);
}

util.inherits(FakeMoray, EventEmitter);


FakeMoray.prototype._del = function _del(bucket, key) {
    var err = getNextMorayError('delObject', { bucket: bucket, key: key });
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
        if (matchObj(filterObj, BUCKET_VALUES[bucket][r])) {
            for (var nk in fields) {
                BUCKET_VALUES[bucket][r].value[nk] = fields[nk];
            }
        }
    }
};




FakeMoray.prototype.batch = function _batch(data, callback) {
    assert.arrayOfObject(data, 'data');

    var err = getNextMorayError('batch', { batch: data });
    if (err) {
        return callback(err);
    }

    for (var b in data) {
        var item = data[b];
        assert.string(item.operation, 'item.operation');
        assert.string(item.bucket, 'item.bucket');

        var knownOp = false;
        ['delete', 'put', 'update'].forEach(function (opt) {
            if (item.operation === opt) {
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


FakeMoray.prototype.close = function morayClose() {
    return;
};


FakeMoray.prototype.createBucket =
    function createBucket(bucket, schema, callback) {

    var err = getNextMorayError('createBucket', { bucket: bucket });
    if (err) {
        return callback(err);
    }

    BUCKETS[bucket] = clone(schema);
    BUCKET_VALUES[bucket] = {};
    return callback();
};


FakeMoray.prototype.delBucket = function delBucket(bucket, callback) {
    var err = getNextMorayError('delBucket', { bucket: bucket });
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
    var limit = opts.limit || 1000;
    var offset = opts.offset || 0;
    var i;

    function compareTo(a, b) {
        if (typeof (a) === 'number') {
            return a - b;
        } else {
            return util_ip.compareTo(a, b);
        }
    }

    process.nextTick(function () {
        var err = getNextMorayError('findObjects',
            { bucket: bucket, filter: filter });
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        // Whenever we call findObjects, it's either unsorted or sorted by ASC,
        // so just sort them ASC every time
        var keys = Object.keys(BUCKET_VALUES[bucket]).sort(compareTo);
        i = 0;
        keys.forEach(function (r) {
            var val = BUCKET_VALUES[bucket][r];
            if (matchObj(filterObj, val)) {
                if (i >= offset && i < offset + limit) {
                    res.emit('record', clone(val));
                }
                i++;
            }
        });

        res.emit('end');
    });

    return res;
};


FakeMoray.prototype.getBucket = function getBucket(bucket, callback) {
    var err = getNextMorayError('getBucket', { bucket: bucket });
    if (err) {
        return callback(err);
    }

    if (!BUCKETS.hasOwnProperty(bucket)) {
        return callback(bucketNotFoundErr(bucket));
    }

    return callback(null, clone(BUCKETS[bucket]));
};


FakeMoray.prototype.getObject = function getObject(bucket, key, callback) {
    var err = getNextMorayError('getObject', { bucket: bucket, key: key });
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

    var err = getNextMorayError('putObject',
            { bucket: bucket, key: key, value: value, opts: opts });
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


FakeMoray.prototype.reindexObjects =
        function reindexObjects(_bucket, _count, _opts, callback) {
    return callback(null, { processed: 0 });
};


FakeMoray.prototype.sql = function sql(str) {
    // Mock out PG's gap detection and subnet filtering

    if (/subnet >> inet\(/.test(str)) {
        // This is from the network overlap detection code: just return an
        // EventEmitter that immediately ends (as if there were no overlapping
        // networks found):
        var evt = new EventEmitter();
        setImmediate(function () {
            evt.emit('end');
        });

        return evt;
    }

    /* BEGIN JSSTYLED */
    var bucket = str.match(/from ([a-z0-9_]+)/);
    var limit = str.match(/limit (\d+)/) || undefined;
    var minIP = str.match(/>= inet\('([a-f0-9.:]+)'/);
    var maxIP = str.match(/<= inet\('([a-f0-9.:]+)'/);
    var min = str.match(/>= (\d+)/);
    var max  = str.match(/<= (\d+)/);
    var subnet = str.match(/<< inet('([a-f0-9.:/]+)')/);
    var subnet_start_ip = str.match(/>> inet('([a-f0-9.:]+)')/);
    /* END JSSTYLED */

    if (limit) {
        limit = Number(limit[1]);
    }

    bucket = bucket[1];

    if (minIP && maxIP) {
        return this._gapIP({
            min: util_ip.toIPAddr(minIP[1]),
            max: util_ip.toIPAddr(maxIP[1]),
            bucket: bucket,
            limit: limit
        });
    }

    if (min && max) {
        return this._gapNumber({
            min: Number(min[1]),
            max: Number(max[1]),
            bucket: bucket,
            limit: limit
        });
    }

    if (subnet && subnet_start_ip) {
        return this._subnetFilter({
            subnet: subnet[1],
            subnet_start_ip: util_ip.toIPAddr(subnet_start_ip[1]),
            bucket: bucket,
            limit: limit
        });
    }

    return null;
};


FakeMoray.prototype._subnetFilter = function _subnetFilter(opts) {
    var subnet = opts.subnet;
    var subnetStart = opts.subnet_start_ip;
    var bucket = opts.bucket;
    var limit = opts.limit;

    assert.string(subnet);
    assert.object(subnetStart);
    assert.string(bucket);
    assert.optionalNumber(limit);

    var bits = Number(subnet.split('/')[1]);

    var res = new EventEmitter();
    setImmediate(function () {
        var err = getNextMorayError('sql', { opts: opts });
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        var bucketKeys = Object.keys(BUCKET_VALUES[bucket]).sort();
        var found = 0;
        for (var i in bucketKeys) {
            var value = BUCKET_VALUES[bucket][bucketKeys[i]].value;
            var other = value.subnet.split('/');
            var otherSubnet = util_ip.toIPAddr(other[0]);
            var otherBits = Number(other[1]);
            if (subnetStart.match(otherSubnet, otherBits) ||
                otherSubnet.match(subnetStart, bits)) {
                if (limit && found < limit) {
                    res.emit('record', value);
                }
                found++;
            }
        }
        res.emit('end');
    });
    return res;
};


FakeMoray.prototype._gapNumber = function _gapNumber(opts) {
    var min = opts.min;
    var max = opts.max;
    var bucket = opts.bucket;
    var limit = opts.limit;

    assert.number(min);
    assert.number(max);
    assert.string(bucket);
    assert.optionalNumber(limit);

    var res = new EventEmitter();
    setImmediate(function () {
        var err = getNextMorayError('sql', { opts: opts });
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        var bucketKeys = Object.keys(BUCKET_VALUES[bucket]).map(function (k) {
            return Number(k);
        }).sort();
        var found = 0;
        var last = bucketKeys[0];
        for (var i in bucketKeys) {
            var ip = bucketKeys[i];
            if ((ip - last) > 1 && (last + 1) <= max && (last + 1) >= min) {
                if (limit && found < limit) {
                    res.emit('record', {
                        // XXX is this right?
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


FakeMoray.prototype._gapIP = function _gapIP(opts) {
    var min = util_ip.toIPAddr(opts.min);
    var max = util_ip.toIPAddr(opts.max);
    var bucket = opts.bucket;
    var limit = opts.limit;

    assert.object(min);
    assert.object(max);
    assert.string(bucket);
    assert.optionalNumber(limit);

    function lte(a, b) {
        return util_ip.compareTo(a, b) <= 0;
    }

    function gt(a, b) {
        return util_ip.compareTo(a, b) > 0;
    }

    function gte(a, b) {
        return util_ip.compareTo(a, b) >= 0;
    }

    function plus(a, b) {
        return util_ip.ipAddrPlus(a, b);
    }

    var res = new EventEmitter();
    setImmediate(function () {
        var err = getNextMorayError('sql', { opts: opts });
        if (err) {
            res.emit('error', err);
            return;
        }

        if (!BUCKET_VALUES.hasOwnProperty(bucket)) {
            res.emit('error', bucketNotFoundErr(bucket));
            return;
        }

        var bucketKeys = Object.keys(BUCKET_VALUES[bucket]).map(function (k) {
            return util_ip.toIPAddr(k);
        }).sort(util_ip.compareTo);
        var found = 0;
        var last = bucketKeys[0];
        for (var i in bucketKeys) {
            var ip = bucketKeys[i];
            if (gt(ip, plus(last, 1)) && // ip > last + 1, or (ip - last) > 1
                lte(plus(last, 1), max) && // (last + 1) <= max
                gte(plus(last, 1), min)) { // (last + 1) >= min

                if (limit && found < limit) {
                    res.emit('record', {
                        // XXX ipaddr minus ipaddr not implemented,
                        // so just return something for gap length
                        gap_length: 100,
                        gap_start: plus(last, 1).toString() // last + 1
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



FakeMoray.prototype.version = function version(opts, callback) {
    var self = this;
    if (typeof (opts) === 'function') {
        callback = opts;
    }
    setImmediate(function () {
        return callback(self._version);
    });
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
    get _lastError() {
        return LAST_MORAY_ERROR;
    },
    FakeMoray: FakeMoray,
    createClient: createClient
};
