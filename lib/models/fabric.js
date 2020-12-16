/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * fabric model
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var mod_vpc_quota = require('./vpc-quota');
var util_common = require('../util/common.js');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');

/*
 * Circular dependencies required at end of file.
 */
var mod_vlan; // = require('./vlan');

// --- Globals



var BUCKET = {
    desc: 'fabric',
    name: 'napi_fabrics',
    schema: {
        index: {
            vnet_id: { type: 'number', unique: true },
            owner_uuid: { type: 'uuid' },
            v: { type: 'number' }
        }
    },
    version: 1
};


// --- Schema validation objects

var GET_SCHEMA = {
    required: {
        owner_uuid: validate.UUID
    }
};

var VPC_GET_SCHEMA = {
    required: {
        vpc_uuid: validate.UUID
    }
};

var VPC_DELETE_SCHEMA = {
    required: {
        vpc_uuid: validate.UUID
    },
    optional: {
        owner_uuid: validate.UUID
    }
};

var VPC_CREATE_SCHEMA = {
    required: {
        owner_uuid: validate.UUID,
        ip4_cidr: validate.subnetIPv4Array
    },
    optional: {
        ip6_cidr: validate.subnetIPv6Array,
        is_default: validate.boolean,
        description: validate.string,
        quota: validate.number
    }
};

var VPC_LIST_SCHEMA = {
    struct: true,
    optional: {
        vpc_id: validate.uuidPrefix,
        limit: validate.limit,
        name: validate.stringOrArray,
        offset: validate.offset,
        owner_uuid: validate.UUID
    }
};

// --- Helpers



/**
 * Generate a random 24-bit virtual network (VxLAN) ID in the correct range
 */
function randomVnetID() {
    return Math.floor(Math.random() * constants.MAX_VNET_ID);
}



// --- Fabric object



/**
 * Fabric model constructor
 */
function Fabric(params) {
    this.params = {
        owner_uuid: params.owner_uuid,
        vnet_id: params.vnet_id || randomVnetID(),
        is_vpc: params.is_vpc || false
    };

    if (this.params.is_vpc) {
        this.params.vpc_uuid = params.vpc_uuid || UUID.v4();
        this.params.is_default = params.is_default || false;
        this.params.ip4_cidr = params.ip4_cidr;

        // For a VPC fabric, the IPv4 CIDR block is required, but the
        // IPv6 block is optional.
        if (params.hasOwnProperty('ip6_cidr')) {
            this.params.ip6_cidr = params.ip6_cidr;
        }
    }
}

// Fabrics use the owner uuid as their moray key since there is one fabric
// per user. There can be multiple VPCs per user, so VPCs have their own
// UUID per VPC, and that is used for them. It might be worth at some
// point completely re-doing the bucket using the vnet_id as the key since
// it _must_ be unique, but that would be a more complicated
Object.defineProperty(Fabric.prototype, 'id', {
    get: function () {
        if (this.params.is_vpc) {
            return this.params.vpc_uuid;
        } else {
            return this.params.owner_uuid;
        }
    }
});

Object.defineProperty(Fabric.prototype, 'vnet_id', {
    get: function () { return this.params.vnet_id; }
});


/**
 * Returns the raw form of the fabric suitable for adding to a moray batch
 */
Fabric.prototype.batch = function fabricBatch() {
    return {
        bucket: BUCKET.name,
        key: this.id,
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag || null
        }
    };
};

Fabric.prototype.delBatch = function fabricDelBatch() {
    return {
        bucket: BUCKET.name,
        key: this.id,
        operation: 'delete',
        value: this.raw(),
        options: {
            etag: this.etag || null
        }
    };
};

/**
 * Returns the raw form of the fabric suitable for storing in moray
 */
Fabric.prototype.raw = function fabricRaw() {
    var raw = {
        owner_uuid: this.params.owner_uuid,
        vnet_id: this.params.vnet_id,
        is_vpc: this.params.is_vpc
    };

    if (this.params.is_vpc) {
        raw.vpc_uuid = this.params.vpc_uuid;
        raw.ip4_cidr = this.params.ip4_cidr;
        raw.ip6_cidr = this.params.ip6_cidr || null;
        raw.is_default = this.params.is_default;
    }

    return raw;
};



// --- Exported functions



/**
 * Gets a fabric
 */
function getFabric(opts, callback) {
    opts.log.debug({ params: opts.params }, 'getFabric: entry');

    validate.params(GET_SCHEMA, null, opts.params, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(opts.app.moray, BUCKET, opts.params.owner_uuid,
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new Fabric(rec.value));
        });
    });
}

function createVPC(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;
    var quotaObj;
    var copts = {
        app: app,
        log: log
    };

    log.debug(params, 'createVPC: entry');

    vasync.waterfall([
        function _validateHttpParams(cb) {
            validate.params(VPC_CREATE_SCHEMA, copts, opts.params,
                function validateCb(err, validated) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    cb(null, validated);
                });
        },

        function _checkQuota(validated, cb) {
            mod_vpc_quota.get({ owner_uuid: validated.owner_uuid },
                function onQuotaGet(err, quota) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    // We need to keep the quota object around a bit so
                    // we can increment the count and re-put it when
                    // creating the new VPC.
                    quotaObj = quota;

                    // If no quota given, bypass any further checks
                    if (!validated.quota) {
                        cb(null, validated);
                        return;
                    }

                    // If under the quota (or quota is unlimited), proceed
                    if (validated.quota === 0 ||
                        quota.vpc_count < validated.quota) {

                        // The 'quota' property isn't a part of the Fabric
                        // object -- it was just optionally passed in
                        // the create request to compare with the accounts
                        // VPC usage. Cloudapi should always include the
                        // user's VPC quota amount from UFDS. We don't
                        // fetch the quota from UFDS here to allow an operator
                        // to bypass the user's quota and create a VPC for a
                        // user via sdc-napi or such.
                        delete validated.quota;

                        cb(null, validated);
                    }

                    cb(new errors.VPCQuotaExceededError(quota.vpc_count,
                        validated.quota));
                });
        },

        function _createVpc(validated, cb) {
            var vpc = new Fabric(validated);
            var batch = [];

            // Regardless of the value of the quota, we always track
            // the count of VPCs
            quotaObj.vpc_count++;

            batch.push(vpc.batch());
            batch.push(quotaObj.batch());

            app.moray.batch(batch, function batchCb(bErr, res) {
                if (bErr) {
                    cb(bErr);
                    return;
                }

                vpc.etag = util_common.getEtag(res.etag, BUCKET.name, vpc.id);

                cb(null, vpc);
            });
        }

    ], function _createCb(err, vpc) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, vpc);
        return;
    });
}

function getVPC(opts, callback) {
    assert.object(opts, 'opts');
    opts.log.debug({ params: opts.params }, 'getVPC: entry');

    validate.params(VPC_GET_SCHEMA, null, opts.params, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(opts.app.moray, BUCKET, opts.params.vpc_uuid,
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new Fabric(rec.value));
        });
    });
}

function listVPC(opts, callback) {
    assert.object(opts, 'opts');

    var app = opts.app;
    var log = opts.log;
    var params = opts.params;

    log.debug(params, 'listVPC entry');

    vasync.waterfall([
        function _validateParams(cb) {
            validate.params(VPC_LIST_SCHEMA, null, params,
            function onValidate(err, validated) {
                if (err) {
                    cb(err);
                    return;
                }

                cb(null, validated);
            });
        },

        function _listObjs(validated, cb) {
            var limit;
            var offset;

            if (validated.offset) {
                offset = Number(validated.offset);
                delete validated.offset;
            }

            if (validated.limit) {
                limit = Number(validated.limit);
                delete validated.limit;
            }

            mod_moray.listObjs({
                defaultFilter: '(vnet_id=*)',
                filter: validated,
                limit: limit,
                log: log,
                offset: offset,
                bucket: BUCKET,
                model: Fabric,
                moray: app.moray,
                sort: {
                    attribute: 'name',
                    order: 'ASC'
                }
            }, cb);
        }
    ], callback);
}

function deleteVPC(opts, callback) {
    assert.object(opts, 'opts');

    var app = opts.app;
    var log = opts.log;

    log.debug(opts.params, 'deleteVPC entry');

    vasync.waterfall([
        function _validateHttpParams(cb) {
            validate.params(VPC_DELETE_SCHEMA, null, opts.params,
                function onValidate(err, validParams) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    cb(null, validParams);
                });
        },

        function _checkVlansInUse(params, cb) {
            mod_vlan.list({
                app: app,
                log: log,
                params: {
                    owner_uuid: params.vpc_uuid
                }
            }, function onVlan(vListErr, vlans) {
                if (vListErr) {
                    cb(vListErr);
                    return;
                }

                if (vlans.length > 0) {
                    cb(new errors.InUseError(
                        constants.msg.VLAN_ON_VPC,
                        vlans.map(function vMapCb(vlan) {
                            return errors.usedBy('vlan', vlan.vlan_id);
                        }).sort(function vSortCb(a, b) {
                            return a.vlan_id < b.vlan_id;
                        })));
                    return;
                }

                cb(null, params);
            });
        },

        // Get the VPC so we can obtain the owner
        function _getVPC(params, cb) {
            mod_moray.getObj(app.moray, BUCKET, params.vpc_uuid,
            function onGetVPC(err, rec) {
                if (err) {
                    cb(err);
                    return;
                }

                cb(null, new Fabric(rec.value));
            });
        },

        function _getQuota(vpc, cb) {
            mod_vpc_quota.get({ owner_uuid: vpc.owner_uuid },
            function onQuotaGet(err, quota) {
                if (err) {
                    cb(err);
                    return;
                }

                var batch = [];

                if (vpc.vpc_count === 0) {
                    log.warn({ vpc: vpc }, 'VPC quota mismatch');
                } else {
                    vpc.vpc_count--;
                }
                batch.push(quota.batch());
                batch.push(vpc.delBatch());
                cb(null, batch);
            });
        },

        function _deleteVpc(batch, cb) {
            app.moray.batch(batch, function onDelete(bErr, res) {
                if (bErr) {
                    cb(bErr);
                    return;
                }

                cb();
            });
        }
        ], callback);
}

/**
 * Initializes the nic tags bucket
 */
function initFabricsBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}



module.exports = {
    Fabric: Fabric,
    get: getFabric,
    createVPC: createVPC,
    getVPC: getVPC,
    deleteVPC: deleteVPC,
    listVPC: listVPC,
    init: initFabricsBucket
};

/*
 * Circular dependency
 */
mod_vlan = require('./vlan');
