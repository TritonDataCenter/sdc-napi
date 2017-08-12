/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * aggregation model
 */

'use strict';

var constants = require('../util/constants');
var errors = require('../util/errors');
var jsprim = require('jsprim');
var mod_mac = require('macaddr');
var mod_moray = require('../apis/moray');
var mod_nic = require('./nic');
var mod_nicTag = require('./nic-tag');
var util = require('util');
var util_common = require('../util/common');
var validate = require('../util/validate');
var vasync = require('vasync');
var VError = require('verror');



// --- Globals



var LACP_MODES = [ 'off', 'active', 'passive' ];
var BUCKET = {
    desc: 'aggregation',
    name: 'napi_aggregations',
    schema: {
        index: {
            belongs_to_uuid: { type: 'string' },
            id: { type: 'string', unique: true },
            macs: { type: '[number]' },
            nic_tags_provided: { type: '[string]' }
        }
    }
};


// --- Schema validation objects

var CREATE_SCHEMA = {
    required: {
        name: validate.interfaceName,
        macs: validateMACs
    },
    optional: {
        lacp_mode: validateLACPmode,
        nic_tags_provided: mod_nicTag.validateExists.bind(null, false)
    }
};

var GET_SCHEMA = {
    required: {
        id: validate.string
    }
};

var LIST_SCHEMA = {
    strict: true,
    optional: {
        belongs_to_uuid: validate.UUID,
        macs: validate.MACarray,
        nic_tags_provided: mod_nicTag.validateExists.bind(null, false),
        limit: validate.limit,
        offset: validate.offset
    }
};

var UPDATE_SCHEMA = {
    optional: {
        lacp_mode: validateLACPmode,
        nic_tags_provided: mod_nicTag.validateExists.bind(null, false),
        macs: validateMACs
    }
};

var DELETE_SCHEMA = {
    required: {
        id: validate.string
    }
};

// --- Helpers



/**
 * Validate that the LACP mode is one of the strings in LACP_MODES above
 */
function validateLACPmode(_, name, mode, callback) {
    validate.string(null, name, mode, function (err) {
        if (err) {
            return callback(err);
        }

        if (LACP_MODES.indexOf(mode) === -1) {
            return callback(new errors.invalidParam(name,
                util.format('Invalid LACP mode. Supported modes: %s',
                    LACP_MODES.join(', '))));
        }

        return callback(null, mode);
    });
}


/**
 * Validate the array of MAC addresses, which includes validating that:
 * - MACs are valid
 * - the nics for those MACs exist
 */
function validateMACs(opts, name, list, callback) {
    var invalid = {};
    var macs = [];
    var macAddrs = [];

    if ((typeof (list) !== 'string') && !util.isArray(list)) {
        return callback(new errors.invalidParam(name,
            'must be an array of MAC addresses'));
    }

    util_common.arrayify(list).forEach(function (m) {
        var mac, macNum;

        if (typeof (m) !== 'string') {
            if (typeof (m) === 'object') {
                invalid['object'] = 1;
            } else {
                invalid[m] = 1;
            }

            return;
        }

        try {
            mac = mod_mac.parse(m);
            macNum = mac.toLong();
            if (macs.indexOf(macNum) === -1) {
                macs.push(macNum);
                macAddrs.push(mac);
            }
        } catch (_) {
            invalid[m] = 1;
        }
    });

    if (!jsprim.isEmpty(invalid)) {
        callback(errors.invalidParam(name, 'invalid MAC addresses',
            { invalid: Object.keys(invalid).sort() }));
        return;
    }

    if (macs.length > constants.MAX_AGGR_MACS) {
        callback(errors.invalidParam(name,
            util.format('maximum of %d MAC addresses supported',
                constants.MAX_AGGR_MACS)));
        return;
    }

    if (macs.length === 0) {
        callback(errors.invalidParam(name,
            'must specify at least one MAC address'));
        return;
    }

    var nicObjs = [];
    var toReturn = {};
    toReturn[name] = macs;

    vasync.forEachParallel({
        inputs: macAddrs,
        func: function (mac, cb) {
            mod_nic.get({
                app: opts.app,
                log: opts.log,
                params: {
                    mac: mac.toLong()
                }
            }, function (gErr, res) {
                if (gErr) {
                    if (!VError.hasCauseWithName(gErr, 'ObjectNotFoundError')) {
                        cb(gErr);
                        return;
                    }

                    invalid[mac.toString()] = 1;
                } else {
                    nicObjs.push(res);
                }

                cb();
            });
        }
    }, function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        if (!jsprim.isEmpty(invalid)) {
            callback(errors.invalidParam(name, 'unknown MAC addresses',
                { invalid: Object.keys(invalid).sort() }));
            return;
        }

        var invalidMACs = [];

        for (var i = 0; i < nicObjs.length; i++) {
            // Make sure all NICs have the same belongs_to_uuid
            if (nicObjs[i].params.belongs_to_uuid
                !== nicObjs[0].params.belongs_to_uuid) {
                callback(errors.invalidParam(name,
                    constants.msg.AGGR_MATCH));
                return;
            }

            // Make sure all NICs belong to a server
            if (nicObjs[i].params.belongs_to_type !== 'server') {
                invalidMACs.push(nicObjs[i].mac.toString());
            }
        }


        if (invalidMACs.length !== 0) {
            var serverErr = errors.invalidParam(name,
                constants.msg.AGGR_BELONGS);
            serverErr.invalid = invalidMACs.sort();
            callback(serverErr);
            return;
        }

        toReturn.belongs_to_uuid = nicObjs[0].params.belongs_to_uuid;

        callback(null, null, toReturn);
    });
}



// --- Aggr object



/**
 * Aggregation model constructor
 */
function Aggr(params) {
    this.params = params;

    if (!this.params.lacp_mode) {
        this.params.lacp_mode = 'off';
    }

    if (this.params.nic_tags_provided &&
        this.params.nic_tags_provided.length === 0) {
        delete this.params.nic_tags_provided;
    }

    this.params.id = util.format('%s-%s', this.params.belongs_to_uuid,
        this.params.name);

    this.etag = params.etag || null;

    Object.seal(this);
}

Object.defineProperty(Aggr.prototype, 'id', {
    get: function () { return this.params.id; }
});


/**
 * Returns the raw moray form of the aggregation
 */
Aggr.prototype.raw = function aggrRaw() {
    var raw = {
        belongs_to_uuid: this.params.belongs_to_uuid,
        id: this.params.id,
        lacp_mode: this.params.lacp_mode,
        macs: this.params.macs,
        name: this.params.name
    };

    if (this.params.hasOwnProperty('nic_tags_provided')) {
        raw.nic_tags_provided = this.params.nic_tags_provided;
    }

    return raw;
};


/**
 * Returns the raw Moray form of this aggregation for adding to a batch.
 */
Aggr.prototype.batch = function aggrBatch() {
    return {
        bucket: BUCKET.name,
        key: this.id,
        operation: 'put',
        value: this.raw(),
        option: {
            etag: this.etag
        }
    };
};


/**
 * Returns the serialized (API-facing) form of the aggregation
 */
Aggr.prototype.serialize = function aggrSerialize() {
    var ser = {
        belongs_to_uuid: this.params.belongs_to_uuid,
        id: this.params.id,
        lacp_mode: this.params.lacp_mode,
        name: this.params.name,
        macs: this.params.macs.map(function (m) {
            return mod_mac.parse(m).toString();
        })
    };

    if (this.params.hasOwnProperty('nic_tags_provided')) {
        ser.nic_tags_provided = this.params.nic_tags_provided;
    }

    return ser;
};



// --- Exported functions



/**
 * Creates a new aggregation
 */
function createAggr(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;
    log.debug(params, 'createAggr: entry');

    validate.params(CREATE_SCHEMA, opts, params, function (vErr, validated) {
        if (vErr) {
            callback(vErr);
            return;
        }

        var aggr = new Aggr(validated);
        app.moray.putObject(BUCKET.name, aggr.id, aggr.raw(),
            { etag: null }, function (pErr) {
            if (pErr) {
                if (VError.hasCauseWithName(pErr, 'EtagConflictError')) {
                    callback(new errors.InvalidParamsError(
                        constants.msg.INVALID_PARAMS, [
                            errors.duplicateParam('name',
                            constants.msg.AGGR_NAME) ]));
                    return;
                }

                callback(pErr);
                return;
            }

            callback(null, aggr);
        });
    });
}


/**
 * Gets an aggregation
 */
function getAggr(opts, callback) {
    opts.log.debug(opts.params, 'getAggr: entry');

    validate.params(GET_SCHEMA, null, opts.params, function (err, validated) {
        if (err) {
            callback(err);
            return;
        }

        mod_moray.getObj(opts.app.moray, BUCKET, validated.id,
            function (err2, rec) {
            if (err2) {
                callback(err2);
                return;
            }

            rec.value.etag = rec._etag;
            callback(null, new Aggr(rec.value));
        });
    });
}


/**
 * Lists aggregations
 */
function listAggrs(opts, callback) {
    opts.log.debug(opts.params, 'listAggrs: entry');

    validate.params(LIST_SCHEMA, opts, opts.params, function (err, validated) {
        var lim, off;

        if (err) {
            return callback(err);
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
            defaultFilter: '(id=*)',
            filter: validated,
            limit: lim,
            log: opts.log,
            offset: off,
            bucket: BUCKET,
            model: Aggr,
            moray: opts.app.moray
        }, callback);
    });
}


/**
 * Updates an aggregation
 */
function updateAggr(opts, callback) {
    opts.log.debug(opts.params, 'updateAggr: entry');

    getAggr(opts, function (getErr, oldAggr) {
        if (getErr) {
            return callback(getErr);
        }

        validate.params(UPDATE_SCHEMA, opts, opts.params,
            function (err, params) {
            if (err) {
                return callback(err);
            }

            mod_moray.updateObj({
                moray: opts.app.moray,
                bucket: BUCKET,
                key: oldAggr.id,
                val: params
            }, function (err2, rec) {
                if (err2) {
                    return callback(err2);
                }

                return callback(null, new Aggr(rec.value));
            });
        });
    });
}


/**
 * Deletes an aggregation
 */
function deleteAggr(opts, callback) {
    opts.log.debug(opts.params, 'deleteAggr: entry');

    validate.params(DELETE_SCHEMA, null, opts.params,
        function (vErr, validated) {
        if (vErr) {
            callback(vErr);
            return;
        }

        mod_moray.delObj(opts.app.moray, BUCKET, validated.id, function (dErr) {
            if (dErr) {
                callback(dErr);
                return;
            }

            opts.log.info(validated, 'deleted aggregation "%s"', validated.id);

            callback();
        });
    });
}


/**
 * Initializes the aggregations bucket
 */
function initAggrs(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
    Aggregation: Aggr,
    bucket: function () { return BUCKET; },
    create: createAggr,
    del: deleteAggr,
    get: getAggr,
    init: initAggrs,
    list: listAggrs,
    update: updateAggr
};
