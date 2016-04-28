/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * aggregation model
 */

'use strict';

var constants = require('../util/constants');
var errors = require('../util/errors');
var jsprim = require('jsprim');
var mod_moray = require('../apis/moray');
var mod_nic = require('./nic');
var mod_nicTag = require('./nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_mac = require('../util/mac');
var validate = require('../util/validate');
var vasync = require('vasync');



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
var MAX_MACS = 16;



// --- Helpers



/**
 * Validate that the LACP mode is one of the strings in LACP_MODES above
 */
function validateLACPmode(name, mode, callback) {
    validate.string(name, mode, function (err) {
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
        if (typeof (m) !== 'string') {
            if (typeof (m) === 'object') {
                invalid['object'] = 1;
            } else {
                invalid[m] = 1;
            }

            return;
        }

        var macNum = util_mac.aton(m);
        if (macNum) {
            if (macs.indexOf(macNum) === -1) {
                macs.push(macNum);
                macAddrs.push(m);
            }
        } else {
            invalid[m] = 1;
        }
    });

    if (!jsprim.isEmpty(invalid)) {
        var mErr = new errors.invalidParam(name, 'invalid MAC addresses',
            { invalid: Object.keys(invalid).sort() });
        return callback(mErr);
    }

    if (macs.length > MAX_MACS) {
        return callback(new errors.invalidParam(name,
            util.format('maximum of %d MAC addresses supported', MAX_MACS)));
    }

    if (macs.length === 0) {
        return callback(new errors.invalidParam(name,
            'must specify at least one MAC address'));
    }

    var nicObjs = [];
    var toReturn = {};
    toReturn[name] = macs;
    toReturn['_nics'] = {};

    vasync.forEachParallel({
        inputs: macAddrs,
        func: function (mac, cb) {
            mod_nic.get({ app: opts.app, log: opts.log, params: { mac: mac } },
                function (gErr, res) {
                if (res) {
                    toReturn._nics[mac] = res;
                    nicObjs.push(res);
                }

                return cb(gErr);
            });
        }
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        var invalidMACs = [];
        var n;

        // Make sure all nics' belongs_to_uuid match
        for (n in nicObjs) {
            if (nicObjs[n].params.belongs_to_uuid
                !== nicObjs[0].params.belongs_to_uuid) {
                return callback(new errors.invalidParam(name,
                    constants.msg.AGGR_MATCH));
           }
        }

        // Make sure all nics belong to a server
        for (n in nicObjs) {
            if (nicObjs[n].params.belongs_to_type !== 'server') {
                invalidMACs.push(util_mac.ntoa(nicObjs[n].mac));
           }
        }

        if (invalidMACs.length !== 0) {
            var serverErr = new errors.invalidParam(name,
                constants.msg.AGGR_BELONGS);
            serverErr.invalid = invalidMACs;
            return callback(serverErr);
        }

        toReturn.belongs_to_uuid = nicObjs[0].params.belongs_to_uuid;
        return callback(null, null, toReturn);
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
 * Returns the serialized (API-facing) form of the aggregation
 */
Aggr.prototype.serialize = function aggrSerialize() {
    var ser = {
        belongs_to_uuid: this.params.belongs_to_uuid,
        id: this.params.id,
        lacp_mode: this.params.lacp_mode,
        name: this.params.name,
        macs: this.params.macs.map(function (m) {
            return util_mac.ntoa(m);
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

    validate.params({
        params: params,

        required: {
            name: validate.interfaceName,
            macs: validateMACs.bind(null, opts)
        },

        optional: {
            lacp_mode: validateLACPmode,
            nic_tags_provided:
                 mod_nicTag.validateExists.bind(null, opts.app, opts.log, false)
        }

    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var aggr = new Aggr(validated);
        app.moray.putObject(BUCKET.name, aggr.id, aggr.raw(),
            { etag: null }, function (err2) {
            if (err2) {
                if (err2.name === 'EtagConflictError') {
                    return callback(new errors.InvalidParamsError(
                        constants.msg.INVALID_PARAMS, [
                            errors.duplicateParam('name',
                            constants.msg.AGGR_NAME) ]));
                }

                return callback(err2);
            }

            return callback(null, aggr);
        });
    });
}


/**
 * Gets an aggregation
 */
function getAggr(opts, callback) {
    opts.log.debug(opts.params, 'getAggr: entry');

    validate.params({
        params: opts.params,
        required: {
            id: validate.string
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(opts.app.moray, BUCKET, validated.id,
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new Aggr(rec.value));
        });
    });
}


/**
 * Lists aggregations
 */
function listAggrs(opts, callback) {
    opts.log.debug(opts.params, 'listAggrs: entry');

    validate.params({
        params: opts.params,
        strict: true,
        optional: {
            belongs_to_uuid: validate.UUID,
            macs: validate.MACarray,
            nic_tags_provided:
                 mod_nicTag.validateExists.bind(null, opts.app, opts.log,
                 false),
            limit: validate.limit,
            offset: validate.offset
        }
    }, function (err, validated) {
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

        var toValidate = {
            params: opts.params,

            optional: {
                lacp_mode: validateLACPmode,
                nic_tags_provided:
                     mod_nicTag.validateExists.bind(null, opts.app, opts.log,
                         false),
                macs: validateMACs.bind(null, opts)
            }
        };

        validate.params(toValidate, function (err, params) {
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

    validate.params({
        params: opts.params,
        required: {
            id: validate.string
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        opts.app.moray.delObject(BUCKET.name, validated.id, function (err2) {
            if (err2) {
                if (err2.name === 'ObjectNotFoundError') {
                    return callback(new restify.ResourceNotFoundError(err2,
                        'aggregation not found'));
                }

                return callback(err2);
            }

            opts.log.info(validated, 'deleted aggregation "%s"', validated.id);
            return callback();
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
