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

'use strict';

var constants = require('../util/constants');
var errors = require('../util/errors');
var fmt = require('util').format;
var mod_fabric = require('./fabric');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
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
// Names that are allowed to be used in the "fields" filter
var VALID_FIELDS = [
    'description',
    'name',
    'owner_uuid',
    'vlan_id',
    'vnet_id'
];



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

    if (params.hasOwnProperty('description')) {
        this.params.description = params.description;
    }

    if (params.fields) {
        this.fields = params.fields;
    }
}

Object.defineProperty(FabricVLAN.prototype, 'id', {
    get: function () { return morayVlanKey(this.params); }
});

Object.defineProperty(FabricVLAN.prototype, 'vnet_id', {
    get: function () { return this.params.vnet_id; }
});


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
    var ser = {};

    if (!this.fields) {
        ser = {
            name: this.params.name,
            owner_uuid: this.params.owner_uuid,
            vlan_id: this.params.vlan_id,
            vnet_id: this.params.vnet_id
        };

        if (this.params.hasOwnProperty('description')) {
            ser.description = this.params.description;
        }

        return ser;
    }

    for (var f in this.fields) {
        if (this.params.hasOwnProperty(this.fields[f])) {
            ser[this.fields[f]] = this.params[this.fields[f]];
        }
    }

    return ser;
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
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN
        },

        optional: {
            name: validate.string,
            description: validate.string,
            fields: validate.fieldsArray.bind(null, VALID_FIELDS)
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
                if (err2.name === 'EtagConflictError') {
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

        mod_net.list({
            app: app,
            log: log,
            params: {
                owner_uuid: validated.owner_uuid,
                vlan_id: validated.vlan_id
            }
        }, function (listErr, nets) {
            if (listErr) {
                return callback(listErr);
            }

            if (nets.length > 0) {
                return callback(new errors.InUseError(
                    constants.msg.NET_ON_VLAN,
                    nets.map(function (net) {
                        return errors.usedBy('network', net.uuid);
                    }).sort(function (a, b) {
                        return a.id < b.id;
                    })));
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
    });
}



/**
 * Gets a Fabric VLAN
 */
function getFabricVLAN(opts, callback) {
    var app = opts.app;
    var checkFields = opts.hasOwnProperty('checkFields') ?
            opts.checkFields : true;
    var log = opts.log;
    log.debug(opts.params, 'getFabricVLAN: entry');

    var validators = {
        params: opts.params,

        required: {
            owner_uuid: validate.UUID,
            vlan_id: validate.VLAN
        }
    };

    // There are two cases we call getFabricVLAN (for now): the first is in
    // the restify handler for GETing a VLAN (eg: GET
    // /fabrics/:owner_uuid/vlan/:vlan_id).  We want to validate the fields
    // array for this case.  The second case is checking VLAN existence in
    // the fabric networks getParentVLAN() handler - the fields passed in here
    // are network fields, not VLAN fields.  They can therefore contain fields
    // not in this module's VALID_FIELDS, so we need to skip validating them
    // and let the network model validate them instead.
    if (checkFields) {
        validators.optional = {
            fields: validate.fieldsArray.bind(null, VALID_FIELDS)
        };
    }

    validate.params(validators, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var key = morayVlanKey(validated);
        mod_moray.getObj(app.moray, BUCKET, key, function (err2, res) {
            if (err2) {
                return callback(err2);
            }

            if (validated.fields) {
                res.value.fields = validated.fields;
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
    log.debug({ params: opts.params }, 'listFabricVLANs: entry');

    validate.params({
        params: opts.params,

        required: {
            owner_uuid: validate.UUID
        },

        optional: {
            fields: validate.fieldsArray.bind(null, VALID_FIELDS),
            offset: validate.offset,
            limit: validate.limit
        }
    }, function (vErr, validated) {
        var lim, off;
        if (vErr) {
            return callback(vErr);
        }

        if (validated.hasOwnProperty('limit')) {
            lim = validated.limit;
            delete validated.limit;
        }

        if (validated.hasOwnProperty('offset')) {
            off = validated.offset;
            delete validated.offset;
        }

        mod_moray.listObjs({
            defaultFilter: fmt('(owner_uuid=%s)', validated.owner_uuid),
            filter: validated,
            limit: lim,
            log: log,
            offset: off,
            bucket: BUCKET,
            model: FabricVLAN,
            moray: app.moray,
            sort: {
                attribute: 'vlan_id',
                order: 'ASC'
            }
        }, function (listErr, vlans) {
            if (listErr) {
                return callback(listErr);
            }

            if (!validated.fields) {
                return callback(null, vlans);
            }

            vlans.forEach(function (vlan) {
                vlan.fields = validated.fields;
            });

            return callback(null, vlans);
        });
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
            vlan_id: validate.VLAN
        },

        optional: {
            description: validate.string,
            fields: validate.fieldsArray.bind(null, VALID_FIELDS),
            name: validate.string
        }
    }, function (vErr, validated) {
        if (vErr) {
            return callback(vErr);
        }

        var updateParams = {};

        [ 'description', 'name' ].forEach(function (p) {
            if (validated.hasOwnProperty(p)) {
                updateParams[p] = validated[p];
            }
        });

        mod_moray.updateObj({
            bucket: BUCKET,
            key: morayVlanKey(validated),
            moray: app.moray,
            val: updateParams
        }, function (uErr, res) {
            if (uErr) {
                return callback(uErr);
            }

            if (validated.fields) {
                res.value.fields = validated.fields;
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
