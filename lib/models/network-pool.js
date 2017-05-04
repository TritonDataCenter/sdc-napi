/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * network pool model
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('../util/errors');
var jsprim = require('jsprim');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');



// --- Globals



var BUCKET = {
    desc: 'network pool',
    name: 'napi_network_pools',
    schema: {
        index: {
            name: { type: 'string' },
            networks: { type: '[string]' },
            owner_uuids_arr: { type: '[string]' },
            family: { type: 'string' },
            uuid: { type: 'string', unique: true },
            description: { type: 'string' },
            v: { type: 'number' },

            // Deprecated indexes, left here in case we need to rollback:
            owner_uuids: { type: 'string' }
        }
    },
    morayVersion: 2,        // moray version must be > than this
    version: 1
};
var MAX_NETS = 64;


// --- Schema validation objects

var CREATE_SCHEMA = {
    required: {
        name: validate.string,
        networks: validateNetworks
    },
    optional: {
        description: validate.string,
        owner_uuids: validate.UUIDarray,
        uuid: validate.UUID
    },
    after: validateNetworkOwners
};

var GET_SCHEMA = {
    required: {
        uuid: validate.UUID
    },
    optional: {
        provisionable_by: validate.UUID
    }
};

var LIST_SCHEMA = {
    strict: true,
    optional: {
        limit: validate.limit,
        offset: validate.offset,
        name: validate.string,
        family: validate.enum([ 'ipv4', 'ipv6' ]),
        networks: validate.stringOrArray,
        provisionable_by: validate.UUID
    },
    after: function (_opts, _, parsed, cb) {
        /*
         * For now we only allow a single network UUID; in the future, once we
         * decide how we want searching on multiple UUIDs to work by default
         * (AND or OR), this restriction can be lifted.
         */
        var networks = parsed.networks;
        if (networks && Array.isArray(networks) && networks.length > 1) {
            cb(new errors.invalidParam('networks',
                'Only one network UUID allowed'));
            return;
        }

        cb();
    }
};

var UPDATE_SCHEMA = {
    required: {
        uuid: validate.UUID
    },
    optional: {
        name: validate.string,
        description: validate.string,
        networks: validateNetworks,
        owner_uuids: function (_, name, uuids, cb) {
            if (uuids === null) {
                // Allow removing owner_uuids with null
                cb(null, []);
                return;
            }

            validate.UUIDarray(null, name, uuids, cb);
        }
    },
    after: function (opts, original, parsed, cb) {
        if (!parsed.hasOwnProperty('owner_uuids') &&
            opts.oldPool.params.hasOwnProperty('owner_uuids')) {
            parsed.owner_uuids = opts.oldPool.params.owner_uuids;
        }

       return validateNetworkOwners(opts, original, parsed, cb);
    }
};

var DELETE_SCHEMA = {
    required: {
        uuid: validate.UUID
    }
};

// --- Helpers



/**
 * Returns true if the network pool with these params is provisionable by
 * the owner specified by uuid
 */
function provisionableBy(params, uuid) {
    if (!params.hasOwnProperty('owner_uuids')) {
        return true;
    }

    mod_moray.valToArray(params, 'owner_uuids');
    return (params.owner_uuids.concat(
        constants.UFDS_ADMIN_UUID).indexOf(uuid) !== -1);
}


/**
 * Fetch the Network objects for each of the given UUIDs.
 */
function getAllNetworks(app, log, uuids, callback) {
    vasync.forEachParallel({
        inputs: uuids,
        func: function (uuid, cb) {
            mod_net.get({
                app: app,
                log: log,
                params: { uuid: uuid }
            }, cb);
        }
    }, function getResults(err, results) {
        if (err) {
            callback(err);
            return;
        }

        function getResult(entry) {
            return entry.result;
        }

        var networks = results.operations.map(getResult);

        callback(null, networks);
    });
}


/**
 * Validate that the networks in a pool are not over the maximum limit, and
 * that they all exist.
 */
function validateNetworks(opts, name, value, callback) {
    validate.UUIDarray(opts, name, value, function (err, uuids) {
        if (err) {
            callback(err);
            return;
        }

        _validateNetworks(opts, name, uuids, callback);
    });
}


function _validateNetworks(opts, name, uuids, callback) {
    var nets = [];
    var notFound = [];
    var pool_family;
    var poolTypeNotMatching = [];
    var validated = [];

    assert.ok(opts.app, 'opts.app');
    assert.ok(opts.log, 'opts.log');

    /*
     * Initialize the pool type to the current family to
     * prevent changing the family of a pool.
     */
    if (opts.hasOwnProperty('oldPool')) {
        pool_family = opts.oldPool.family;
    }

    if (uuids.length === 0) {
        callback(errors.invalidParam(name,
            constants.POOL_MIN_NETS_MSG));
        return;
    }

    if (uuids.length > MAX_NETS) {
        callback(errors.invalidParam(name,
            util.format('maximum %d networks per network pool', MAX_NETS)));
        return;
    }

    vasync.forEachParallel({
        inputs: uuids,
        func: function _validateNetworkUUID(uuid, cb) {
            mod_net.get({
                app: opts.app,
                log: opts.log,
                params: { uuid: uuid }
            }, function (err, net) {
                if (err) {
                    if (err.name === 'ResourceNotFoundError') {
                        notFound.push(uuid);
                        cb();
                    } else {
                        cb(err);
                    }
                    return;
                }

                if (pool_family === undefined) {
                    pool_family = net.family;
                }

                if (net.family !== pool_family) {
                    poolTypeNotMatching.push(uuid);
                    cb();
                    return;
                }

                validated.push(uuid);
                nets.push(net);
                cb();
            });
        }
    }, function (err) {
        if (err) {
            callback(err);
            return;
        }

        if (notFound.length !== 0) {
            err = errors.invalidParam(name,
                util.format('unknown network%s',
                    notFound.length === 1 ? '' : 's'));
            err.invalid = notFound;
            callback(err);
            return;
        }

        if (poolTypeNotMatching.length !== 0) {
            callback(errors.invalidParam(name,
                constants.POOL_AF_MATCH_MSG));
            return;
        }

        var toReturn = { _netobjs: nets };
        toReturn[name] = validated;

        callback(null, null, toReturn);
    });
}


/**
 * Validate that if a pool has an owner_uuid, all networks in the pool either
 * match that owner_uuid or have no owner_uuid.
 */
function validateNetworkOwners(_opts, _, parsed, callback) {
    if (!parsed.owner_uuids || !parsed._netobjs ||
        parsed.owner_uuids.length === 0 ||
        parsed._netobjs.length === 0) {
        callback();
        return;
    }

    var owners = {};
    parsed.owner_uuids.concat(constants.UFDS_ADMIN_UUID).forEach(function (u) {
        owners[u] = 1;
    });

    var notMatching = [];
    parsed._netobjs.forEach(function (net) {
        if (net.params.hasOwnProperty('owner_uuids')) {
            for (var o in net.params.owner_uuids) {
                if (owners.hasOwnProperty(net.params.owner_uuids[o])) {
                    return;
                }
            }

            notMatching.push(net.uuid);
        }
    });

    if (notMatching.length !== 0) {
        var err = errors.invalidParam('networks',
            constants.POOL_OWNER_MATCH_MSG);
        err.invalid = notMatching;
        callback(err);
        return;
    }

    callback();
}



// --- NetworkPool object



/**
 * Network pool model constructor
 */
function NetworkPool(params) {
    assert.object(params, 'params');

    delete params.nic_tag;

    /*
     * If we're migrating the network pool objects in Moray after a bucket
     * upgrade, then the "_netobjs" array won't be present. If we're
     * responding to a request, then we'll have the networks, and can set
     * fields based on that information.
     */
    if (params._netobjs && Array.isArray(params._netobjs) &&
        params._netobjs.length !== 0) {
        params.family = params._netobjs[0].family;
        params.nic_tags_present = [];
        params._netobjs.forEach(function (network) {
            var nic_tag = network.nic_tag;
            if (params.nic_tags_present.indexOf(nic_tag) === -1) {
                params.nic_tags_present.push(nic_tag);
            }
        });
    }

    mod_moray.valToArray(params, 'owner_uuids');
    this.params = params;

    if (!this.params.uuid) {
        this.params.uuid = UUID.v4();
    }

    if (this.params.hasOwnProperty('networks')) {
        this.params.networks = util_common.arrayify(this.params.networks);
    }

    this.etag = params.etag || null;

    Object.seal(this);
}

Object.defineProperty(NetworkPool.prototype, 'networks', {
    get: function () { return this.params._netobjs; }
});

Object.defineProperty(NetworkPool.prototype, 'family', {
    get: function () {
        if (this.params.family !== undefined) {
            return this.params.family;
        }

        return 'ipv4';
    }
});

Object.defineProperty(NetworkPool.prototype, 'uuid', {
    get: function () { return this.params.uuid; }
});


/**
 * Returns the raw moray form of the network pool
 */
NetworkPool.prototype.raw = function poolRaw() {
    var raw = {
        v: BUCKET.version,
        family: this.family,
        uuid: this.params.uuid,
        name: this.params.name,
        description: this.params.description,
        networks: this.params.networks.sort()
    };

    if (this.params.owner_uuids) {
        raw.owner_uuids_arr = this.params.owner_uuids;
        raw.owner_uuids = mod_moray.arrayToVal(this.params.owner_uuids);
    }

    return raw;
};


/**
 * Returns the raw Moray form of this pool for adding to a batch.
 */
NetworkPool.prototype.batch = function poolBatch() {
    return {
        bucket: BUCKET.name,
        key: this.uuid,
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag
        }
    };
};


/**
 * Returns the serialized (API-facing) form of the network pool
 */
NetworkPool.prototype.serialize = function poolSerialize() {
    var ser = {
        family: this.family,
        uuid: this.params.uuid,
        name: this.params.name,
        description: this.params.description,
        networks: this.params.networks.sort()
    };

    if (this.params.hasOwnProperty('nic_tags_present')) {
        ser.nic_tags_present = this.params.nic_tags_present;

        /*
         * Set a representative "nic_tag" to provide backwards
         * compatibility with older NAPI consumers:
         */
        ser.nic_tag = this.params.nic_tags_present[0];
    }

    if (this.params.owner_uuids) {
        ser.owner_uuids = this.params.owner_uuids;
    }

    return ser;
};



// --- Exported functions



/**
 * Creates a new network pool
 */
function createNetworkPool(app, log, params, callback) {
    log.debug(params, 'createNetworkPool: entry');

    validate.params(CREATE_SCHEMA, { app: app, log: log }, params,
        function (err, validatedParams) {
        if (err) {
            callback(err);
            return;
        }

        var pool = new NetworkPool(validatedParams);
        app.moray.putObject(BUCKET.name, pool.uuid, pool.raw(), { etag: null },
            function (err2) {
            if (err2) {
                callback(err2);
                return;
            }

            callback(null, pool);
        });
    });
}


/**
 * Gets a network pool
 */
function getNetworkPool(app, log, params, callback) {
    log.debug(params, 'getNetworkPool: entry');

    validate.params(GET_SCHEMA, null, params, function (err, validated) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(app.moray, BUCKET, validated.uuid,
            function (err2, rec) {
            if (err2) {
                callback(err2);
                return;
            }

            rec.value.etag = rec._etag;

            if (validated.provisionable_by &&
                !provisionableBy(rec.value, validated.provisionable_by)) {
                callback(new restify.NotAuthorizedError(
                    constants.msg.POOL_OWNER));
                return;
            }

            var netUUIDs = rec.value.networks;

            assert.array(netUUIDs, 'network pool UUIDs');

            // No networks - don't bother trying to fetch anything.
            if (netUUIDs.length === 0) {
                callback(null, new NetworkPool(rec.value));
                return;
            }

            getAllNetworks(app, log, netUUIDs, function (err3, res) {
                if (err3) {
                    callback(err3);
                    return;
                }

                rec.value._netobjs = res;
                callback(null, new NetworkPool(rec.value));
            });
        });
    });
}


/**
 * Lists network pools
 */
function listNetworkPools(app, log, oparams, callback) {
    log.debug({ params: oparams }, 'listNetworkPools: entry');

    validate.params(LIST_SCHEMA, null, oparams, function (valErr, params) {
        if (valErr) {
            callback(valErr);
            return;
        }

        var filterObj = {};

        if (params.provisionable_by) {
            // Match both pools with that owner_uuid as well as no owner_uuid
            filterObj.owner_uuids_arr = [ params.provisionable_by, '!*' ];
        }

        if (params.family) {
            filterObj.family = params.family;
        }

        if (params.name) {
            filterObj.name = params.name;
        }

        if (params.networks) {
            filterObj.networks = params.networks;
        }

        var filter = jsprim.isEmpty(filterObj) ?
            '(uuid=*)' : mod_moray.filter(filterObj);

        var req = app.moray.findObjects(BUCKET.name, filter, {
            limit: params.limit,
            offset: params.offset,
            sort: {
                attribute: 'uuid',
                order: 'ASC'
            }
        });

        var values = [];

        req.on('error', function _onListErr(err) {
            return callback(err);
        });

        req.on('record', function _onListRec(rec) {
            log.debug(rec, 'record from moray');
            values.push(rec.value);
        });

        req.on('end', function _endList() {
            vasync.forEachParallel({
                inputs: values,
                func: function _getNet(val, cb) {
                    if (!val.networks) {
                        cb();
                        return;
                    }

                    var nets = util_common.arrayify(val.networks);
                    if (nets.length === 0) {
                        cb();
                        return;
                    }

                    getAllNetworks(app, log, nets, function (err, res) {
                        if (res) {
                            val._netobjs = res;
                        }

                        cb(err);
                    });
                }
            }, function (err) {
                if (err) {
                    callback(err);
                    return;
                }

                var pools = values.map(function (n) {
                    return new NetworkPool(n);
                });

                callback(null, pools);
            });
        });
    });
}


/**
 * Updates a network pool
 */
function updateNetworkPool(app, log, params, callback) {
    log.debug(params, 'updateNetworkPool: entry');

    getNetworkPool(app, log, params, function (getErr, oldPool) {
        if (getErr) {
            callback(getErr);
            return;
        }

        if (!params.hasOwnProperty('networks') &&
            params.hasOwnProperty('owner_uuids') &&
            oldPool.params.hasOwnProperty('networks')) {
            // We need to fetch the networks to validate owner_uuid, so just
            // let validateNetworks() take care of it
            params.networks = oldPool.params.networks;
        }

        var uopts = {
            app: app,
            log: log,
            oldPool: oldPool
        };

        validate.params(UPDATE_SCHEMA, uopts, params,
            function (err, validatedParams) {
            if (err) {
                callback(err);
                return;
            }

            if (validatedParams.hasOwnProperty('owner_uuids') &&
                validatedParams.owner_uuids.length === 0) {
                validatedParams.owner_uuids = null;
            }

            var updatedParams = oldPool.raw();
            updatedParams._netobjs = oldPool.params._netobjs;

            for (var p in validatedParams) {
                updatedParams[p] = validatedParams[p];
            }

            var newPool = new NetworkPool(updatedParams);

            app.moray.putObject(BUCKET.name, params.uuid, newPool.raw(), {
                etag: oldPool.etag
            }, function (err2) {
                if (err2) {
                    callback(err2);
                    return;
                }

                callback(null, newPool);
            });
        });
    });
}


/**
 * Deletes a network pool
 */
function deleteNetworkPool(app, log, params, callback) {
    log.debug(params, 'deleteNetworkPool: entry');

    validate.params(DELETE_SCHEMA, null, params, function (err) {
        if (err) {
            return callback(err);
        }

        app.moray.delObject(BUCKET.name, params.uuid, callback);
    });
}


/**
 * Initializes the network pools bucket
 */
function initNetworkPools(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
    bucket: function () { return BUCKET; },
    create: createNetworkPool,
    del: deleteNetworkPool,
    get: getNetworkPool,
    init: initNetworkPools,
    list: listNetworkPools,
    NetworkPool: NetworkPool,
    update: updateNetworkPool
};
