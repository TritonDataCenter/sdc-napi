/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * Fabric vlan model
 */

'use strict';

var constants = require('../util/constants');
var errors = require('../util/errors');
var fmt = require('util').format;
var mod_moray = require('../apis/moray');
var util_common = require('../util/common.js');
var validate = require('../util/validate');
var vasync = require('vasync');
var VError = require('verror');

/*
 * Circular dependencies required at end of file.
 */
var mod_fabric;
var mod_net;

// --- Globals



/*
 * Bucket definition - see morayVlanKey() below for the key format
 */
var BUCKET = {
    desc: 'vlan',
    name: 'napi_fabric_vlans',
    schema: {
        index: {
            owner_uuid: { type: 'uuid' },
            vpc_uuid: { type: 'uuid' },
            vlan_id: { type: 'number' },
            v: { type: 'number' }
        }
    },
    morayVersion: 2,
    version: 2
};

// Names that are allowed to be used in the "fields" filter
var VALID_FIELDS = [
    'description',
    'name',
    'owner_uuid',
    'vlan_id',
    'vnet_id'
];

// SQL used to find the largest used vlan_id in the given VPC
var LARGEST_VLAN_SQL =
    'SELECT MAX(vlan_id) ' +
    'FROM %s ' +
    'WHERE vpc_uuid = $1';

// SQL used to find the gaps in assigned vlan_id values in the given VPC
var NEXT_GAP_SQL =
    'SELECT * ' +
    'FROM (' +
    '  SELECT vnet_id + 1 gap_start, ' +
    '         lead(vnet_id) OVER (ORDER BY vnet_id) - vnet_id - 1 gap_length' +
    '  FROM %s ' +
    '  WHERE vpc_uuid = $1' +
    ') t ' +
    'WHERE gap_length > 0';

// --- Schema validation objects

var CREATE_SCHEMA = {
    required: {
        owner_uuid: validate.UUID,
        vlan_id: validate.VLAN
    },
    optional: {
        name: validate.string,
        description: validate.string,
        fields: validate.fieldsArray(VALID_FIELDS)
    }
};

var VPC_CREATE_SCHEMA = {
    required: {
        owner_uuid: validate.UUID,
        vpc_uuid: validate.UUID
    },
    optional: {
        name: validate.string,
        description: validate.string,
        fields: validate.fieldsArray(VALID_FIELDS)
    }
};

var DELETE_SCHEMA = {
    required: {
        owner_uuid: validate.UUID,
        vlan_id: validate.VLAN
    }
};

var VPC_DELETE_SCHEMA = {
    required: {
        vpc_uuid: validate.UUID,
        vlan_id: validate.VLAN
    }
};

var LIST_SCHEMA = {
    required: {
        owner_uuid: validate.UUID
    },
    optional: {
        vpc_uuid: validate.UUID,
        fields: validate.fieldsArray(VALID_FIELDS),
        offset: validate.offset,
        limit: validate.limit
    }
};

var UPDATE_SCHEMA = {
    required: {
        owner_uuid: validate.UUID,
        vlan_id: validate.VLAN
    },
    optional: {
        description: validate.string,
        fields: validate.fieldsArray(VALID_FIELDS),
        name: validate.string
    }
};

var VPC_UPDATE_SCHEMA = {
    required: {
        vpc_uuid: validate.UUID,
        vlan_id: validate.VLAN
    },
    optional: {
        description: validate.string,
        fields: validate.fieldsArray(VALID_FIELDS),
        name: validate.string
    }
};

// --- Internal



/*
 * Returns a key suitable for storing an object in moray. For fabrics, the
 * owner_uuid is sufficient to uniquify the vlan IDs. However since an
 * account can have multiple VPCs, we must use the VPC UUID for those
 * instead.
 */
function morayVlanKey(params) {
    var uuid = params.vpc_uuid ? params.vpc_uuid : params.owner_uuid;
    return uuid + ':' + params.vlan_id;
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

    if (params.hasOwnProperty('vpc_uuid')) {
        this.params.vpc_uuid = params.vpc_uuid;
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
 * Returns the raw form suitable for deleting in a moray batch
 */
FabricVLAN.prototype.delBatch = function fabricVlanDelBatch() {
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

        if (this.params.hasOwnProperty('vpc_uuid')) {
            ser.vpc_uuid = this.params.vpc_uuid;
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

    validate.params(CREATE_SCHEMA, null, params, function (err, validated) {
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

        app.moray.batch(batch, function (bErr, res) {
            if (bErr) {
                // XXX: distinguish between which of these conflicted, and
                // retry if it was the fabric
                if (VError.hasCauseWithName(bErr, 'EtagConflictError')) {
                    callback(new errors.InUseError(
                        constants.msg.VLAN_USED, [
                            errors.duplicateParam('vlan_id',
                                'VLAN ID is already in use')
                        ]));
                    return;
                }

                callback(bErr);
                return;
            }

            vlan.etag =
                util_common.getEtag(res.etags, BUCKET.name, vlan.id);

            callback(null, vlan);
        });
    });
}

/**
 * Find the next unused vlan for the given VPC. The approach is to
 * try MAX(vlan_id) + 1.
 */
function nextVlanId(vpc_uuid, opts, callback) {
    var moray = opts.app.moray;
    var log = opts.log;

    var sql;
    var args = [ vpc_uuid ];

    sql = fmt(LARGEST_VLAN_SQL, BUCKET.name);

    log.debug({
        sql: sql,
        args: args
    }, 'nextVlanId: finding next unused vlan id');

    var req = moray.sql(sql, args);
    var vlanId = null;

    req.on('record', function onRecord(r) {
        log.debug({
            rec: r
        }, 'nextVlanId: highest vlan id in use');

        vlanId = r.vlan_id + 1;
    });

    req.once('error', function onErr(err) {
        log.error('nextVlanId: error');
        callback(err);
    });

    req.once('end', function onEnd() {
        log.debug({
            vlan_id: vlanId
        }, 'nextVlanId: last Id in use');

        callback(null, vlanId);
    });
}

/**
 * Similar to nextVlanId, except look for the first gap in the vlan ids for
 * this vpc.
 */
function nextVlanGap(vpc_uuid, opts, callback) {
    var moray = opts.app.moray;
    var log = opts.log;

    var sql;
    var args = [ vpc_uuid ];

    sql = fmt(NEXT_GAP_SQL, BUCKET.name);

    log.debug({
        sql: sql,
        args: args
    }, 'nextVlanId: finding next unused vlan id');

    var req = moray.sql(sql, args);
    var gap = [];

    req.on('record', function onRecord(r) {
        log.debug({
            rec: r
        }, 'nextVlanGap: gap');

        gap.push(r);
    });

    req.once('error', function onErr(err) {
        log.error('nextVlanGap: error');
        callback(err);
    });

    req.once('end', function onEnd() {
        log.debug({
            gaps: gap
        }, 'nextVlanGap: all gaps found');

        callback(null, gap);
    });
}

function getId(vpc_uuid, opts, callback) {
    vasync.tryEach([
        function _tryNext(cb) {
            nextVlanId(vpc_uuid, opts, function onNext(err, id) {
                if (err) {
                    cb(err);
                    return;
                }

                if (id === null) {
                    cb(null, constants.VLAN_ID_MIN);
                    return;
                }

                if (id >= constants.VLAN_ID_MAX) {
                    // We don't really use this error message, except to
                    // have tryEach to move on to trying to find gaps.
                    cb(new errors.invalidParam('vlan_id'));
                    return;
                }

                cb(null, id + 1);
            });
        },

        function _tryGap(cb) {
            nextVlanGap(vpc_uuid, opts, function onGap(err, gap) {
                if (err) {
                    cb(err);
                    return;
                }

                if (!gap || gap.gap_start >= constants.VLAN_ID_MAX) {
                    cb(new errors.VPCFullError(vpc_uuid));
                    return;
                }

                cb(null, gap.gap_start);
            });
        }
    ], function nextId(err, id) {
        if (err) {
            callback(err);
            return;
        }

        callback(null, id);
    });
}

/**
 * Creates a new VPC VLAN.
 *
 * This differs from creating a Fabric VLAN in three ways:
 * - The Fabric _object_ must already exist (i.e. the vnet id must already be
 *   allocated).
 *
 * - The vlan id will be automatically allocated if not given. The default
 *   is automatic allocation.
 *
 * - This function doesn't actually create the object in moray, but merely
 *   invokes the callback with a new FabricVLAN instance suitable for a
 *   moray batch (so that it can be added to the batch creating a VPC network).
 */
function createVpcVLAN(opts, callback) {
    var log = opts.log;
    var params = opts.params;

    log.debug(params, 'createVpcVLAN: entry');

    vasync.waterfall([
        function _validate(cb) {
            validate.params(VPC_CREATE_SCHEMA, null, params,
            function onValidate(err, validated) {
                if (err) {
                    cb(err);
                    return;
                }
                cb(null, validated);
            });
        },

        function _getId(validated, cb) {
            getId(validated.vpc_uuid, opts, function onId(err, id) {
                if (err) {
                    cb(err);
                    return;
                }

                validated.vlan_id = id;
                cb(null, new FabricVLAN(validated));
            });
        }
    ], function createDone(vlan) {
        callback(null, vlan);
    });
}

/**
 * Common code for deleteing vlans (both fabric and vpc).
 */
function deleteVLAN(vpc, opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'deleteVLAN: entry');

    vasync.waterfall([
        function _validate(cb) {
            var schema = vpc ? VPC_DELETE_SCHEMA : DELETE_SCHEMA;

            validate.params(schema, null, opts.params,
                function _onValidate(err, validated) {
                    if (err) {
                        cb(err);
                        return;
                    }

                    cb(null, validated);
                });
        },

        function _checkInUse(validated, cb) {
            var params = {
                vlan_id: validated.vlan_id
            };

            if (vpc) {
                params['vpc_uuid'] = validated.vpc_uuid;
            } else {
                params['owner_uuid'] = validated.owner_uuid;
            }

            mod_net.list({
                app: app,
                log: log,
                params: params
            }, function onList(err, nets) {
                if (err) {
                    cb(err);
                    return;
                }

                if (nets.length > 0) {
                    cb(new errors.InUseError(
                        constants.msg.NET_ON_VLAN,
                        nets.map(function (net) {
                            return errors.usedBy('network', net.uuid);
                        }).sort(function (a, b) {
                            return a.id < b.id;
                        })));
                    return;
                }

                cb(null, validated);
            });
        },

        function doDelete(validated, cb) {
            var key = morayVlanKey(validated);

            mod_moray.delObj(app.moray, BUCKET, key, function onDel(err) {
                if (err) {
                    cb(err);
                    return;
                }

                log.info(validated, 'deleted fabric/vpc vlan %s', key);
                cb();
            });
        }
    ], function deleteDone(err) {
        callback(err);
    });
}

/**
 * Deletes a Fabric VLAN
 */
function deleteFabricVLAN(opts, callback) {
    var log = opts.log;
    log.debug(opts.params, 'deleteFabricVLAN: entry');

    deleteVLAN(false, opts, callback);
}

function deleteVpcVLAN(opts, callback) {
    var log = opts.log;
    log.debug(opts.params, 'deleteFabricVLAN: entry');

    deleteVLAN(true, opts, callback);
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
            fields: validate.fieldsArray(VALID_FIELDS)
        };
    }

    validate.params(validators, null, opts.params, function (err, validated) {
        if (err) {
            callback(err);
            return;
        }

        var key = morayVlanKey(validated);
        mod_moray.getObj(app.moray, BUCKET, key, function (err2, res) {
            if (err2) {
                callback(err2);
                return;
            }

            if (validated.fields) {
                res.value.fields = validated.fields;
            }

            res.value.etag = res._etag;

            callback(null, new FabricVLAN(res.value));
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

    validate.params(LIST_SCHEMA, null, opts.params, function (vErr, validated) {
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
            defaultFilter: fmt('(&(owner_uuid=%s)(!(vpc_uuid=*)))',
                validated.owner_uuid),
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
    var log = opts.log;
    log.debug(opts.params, 'updateFabricVLAN: entry');

    updateVLANcommon(false, opts, callback);
}

function updateVpcVLAN(opts, callback) {
    var log = opts.log;
    log.debug(opts.params, 'updateFabricVLAN: entry');

    updateVLANcommon(true, opts, callback);
}

function updateVLANcommon(vpc, opts, callback) {
    var app = opts.app;
    var schema = vpc ? VPC_UPDATE_SCHEMA : UPDATE_SCHEMA;

    validate.params(schema, null, opts.params,
        function (vErr, validated) {
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
            original: opts.existingVlan.raw(),
            etag: opts.existingVlan.etag,
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
    update: updateFabricVLAN,

    createVpc: createVpcVLAN,
    delVpc: deleteVpcVLAN,
    updateVpc: updateVpcVLAN
};

/*
 * Circular dependency
 */
mod_fabric = require('./fabric');
mod_net = require('./network');
