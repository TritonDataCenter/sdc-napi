/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Fabric vlan model
 */

var constants = require('../util/constants');
var errors = require('../util/errors');
var fmt = require('util').format;
var mod_fabric = require('./fabric');
var mod_moray = require('../apis/moray');
var restify = require('restify');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_subnet = require('../util/subnet');
var UUID = require('node-uuid');
var validate = require('../util/validate');



// --- Globals



/*
 * Bucket definition - see morayVlanKey() below for the key format
 */
var BUCKET = {
    desc: 'vlan',
    name: 'napi_fabric_vlans',
    schema: {
        index: {
            owner_uuid: { type: 'string' },
            uuid: { type: 'string', unique: true },
            vlan_id: { type: 'number' },
            v: { type: 'number' }
        }
    },
    version: 0
};



// --- Internal



/*
 * Returns a key suitable for storing an object in moray
 */
function morayVlanKey(params) {
    return params.owner_uuid + ':' + params.vlan_id;
}



// --- FabricVLAN object



/**
 * FabricVLAN model constructor
 */
function FabricVLAN(params) {
    this.params = {
        name: params.name,
        owner_uuid: params.owner_uuid,
        vlan_id: Number(params.vlan_id),
        vnet_id: params.vnet_id,
        v: BUCKET.migrationVersion
    };

    this.etag = params.etag || null;

    this.__defineGetter__('id', function () {
        return morayVlanKey(params);
    });
    this.__defineGetter__('vnet_id', function () {
        return this.params.vnet_id;
    });
}


/**
 * Returns the raw form suitable for adding to a moray batch
 */
FabricVLAN.prototype.batch = function fabricVlanBatch() {
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


/**
 * Returns the raw form suitable for storing in moray
 */
FabricVLAN.prototype.raw = function fabricVlanRaw() {
    return this.params;
};



/**
 * Returns the serialized form of the VLAN
 */
FabricVLAN.prototype.serialize = function fabricVlanSerializer() {
    return {
        name: this.params.name,
        owner_uuid: this.params.owner_uuid,
        vlan_id: this.params.vlan_id,
        vnet_id: this.params.vnet_id
    };
};



// --- Exported functions



/**
 * Creates a new Fabric VLAN
 */
function createFabricVLAN(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;
    log.debug(params, 'createFabricVLAN: entry');

    validate.params({
        params: params,

        required: {
            name: validate.string,
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN
        }

    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var batch = [];
        var fabric = opts.fabric;
        var vlan;

        if (!fabric) {
            fabric = new mod_fabric.Fabric(validated);
            batch.push(fabric.batch());
        }

        validated.vnet_id = fabric.vnet_id;
        vlan = new FabricVLAN(validated);

        batch.push(vlan.batch());

        app.moray.batch(batch, function (err2) {
            if (err2) {
                // XXX: distinguish between which of these conflicted, and
                // retry if it was the fabric
                if (err2.name == 'EtagConflictError') {
                    return callback(new errors.InUseError(
                        constants.msg.VLAN_USED, [
                            errors.duplicateParam('vlan_id',
                                'VLAN ID is already in use')
                        ]));
                }

                return callback(err2);
            }

            return callback(null, vlan);
        });
    });
}



/**
 * Deletes a Fabric VLAN
 */
function deleteFabricVLAN(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'deleteFabricVLAN: entry');

    validate.params({
        params: opts.params,
        required: {
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var key = morayVlanKey(validated);
        mod_moray.delObj(app.moray, BUCKET, key, function (err2) {
            if (err2) {
                return callback(err2);
            }

            log.info(validated, 'deleted fabric vlan %s', key);
            return callback();
        });
    });
}



/**
 * Gets a Fabric VLAN
 */
function getFabricVLAN(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'getFabricVLAN: entry');

    validate.params({
        params: opts.params,
        required: {
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var key = morayVlanKey(validated);
        mod_moray.getObj(app.moray, BUCKET, key, function (err2, res) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new FabricVLAN(res.value));
        });
    });
}



/**
 * Initializes the Fabric VLANs bucket
 */
function initFabricVLANsBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}



/**
 * Lists Fabric VLANs
 */
function listFabricVLANs(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'listFabricVLANs: entry');

    validate.params({
        params: opts.params,
        required: {
            owner_uuid: validate.UUID
        }
    }, function (vErr, validated) {
        if (vErr) {
            return callback(vErr);
        }

        // XXX: This should be an EventEmitter
        mod_moray.listObjs({
            defaultFilter: fmt('(owner_uuid=%s)', validated.owner_uuid),
            filter: validated,
            log: log,
            bucket: BUCKET,
            model: FabricVLAN,
            moray: app.moray,
            sort: {
                attribute: 'vlan_id',
                order: 'ASC'
            }
        }, callback);
    });
}



/**
 * Updates a Fabric VLAN
 */
function updateFabricVLAN(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'updateFabricVLAN: entry');

    validate.params({
        params: opts.params,
        required: {
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN,
            name: validate.string
        }
    }, function (vErr, validated) {
        if (vErr) {
            return callback(vErr);
        }

        mod_moray.updateObj({
            bucket: BUCKET,
            key: morayVlanKey(validated),
            moray: app.moray,
            val: {
                // We only allow updating the name for now
                name: validated.name
            }
        }, function (uErr, res) {
            if (uErr) {
                return callback(uErr);
            }

            return callback(null, new FabricVLAN(res.value));
        });
    });
}


module.exports = {
    bucket: function () { return BUCKET; },
    create: createFabricVLAN,
    del: deleteFabricVLAN,
    FabricVLAN: FabricVLAN,
    get: getFabricVLAN,
    init: initFabricVLANsBucket,
    list: listFabricVLANs,
    update: updateFabricVLAN
};
