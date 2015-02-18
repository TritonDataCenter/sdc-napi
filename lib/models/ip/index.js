/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * IP model
 */

var assert = require('assert-plus');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var IP = common.IP;
var mod_moray = require('../../apis/moray');
var restify = require('restify');
var util = require('util');
var util_common = require('../../util/common');
var util_ip = require('../../util/ip');
var util_mac = require('../../util/mac');
var validate = require('../../util/validate');
var vasync = require('vasync');



// --- Globals



// Parameters used for creating a new nic object. Some are optional.
var CREATE_PARAMS = [
    'belongs_to_type',
    'belongs_to_uuid',
    'check_owner',
    'ip',
    'network',
    'network_uuid',
    'owner_uuid',
    'reserved'
];
// Parameters that are shared with nics
var NIC_SHARED_PARAMS = [
    'belongs_to_type',
    'belongs_to_uuid',
    'check_owner',
    'owner_uuid',
    'reserved'
];



// --- Internal helpers


/**
 * Validates that a network object is present
 */
function validateNetworkObj(name, net, callback) {
    if (!net || typeof (net) !== 'object') {
        return callback(errors.invalidParam(name,
            'could not find network'));
    }

    return callback(null, net);
}


/**
 * If we are attempting to add or update owner_uuid, ensure that it
 * matches the network
 */
function validateNetworkOwner(params, validated, callback) {
    if (!validated.network) {
        // We've already failed to validate the network - just return
        return callback();
    }

    if (validated.owner_uuid &&
        (!validated.hasOwnProperty('check_owner') ||
        validated.check_owner) &&
        !validated.network.isOwner(validated.owner_uuid)) {
        return callback(errors.invalidParam('owner_uuid',
            constants.OWNER_MATCH_MSG));
    }

    return callback();
}



// --- Exports



/*
 * List IPs in a network
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ips)`
 */
function listNetworkIPs(app, log, params, callback) {
    log.debug(params, 'listNetworkIPs: entry');
    var bucket = common.getBucketObj(params.network_uuid);
    var ips = [];

    var listOpts = {
        sort: {
            attribute: 'ip',
            order: 'ASC'
        }
    };

    var req = app.moray.findObjects(bucket.name,
        mod_moray.filter(params, bucket) || '(ip=*)', listOpts);

    req.on('error', function _onNetListErr(err) {
        return callback(err);
    });

    req.on('record', function _onNetListRec(rec) {
        // If a record is not reserved, do not display it (the 2 keys in value
        // in this case are 'reserved' and 'ip')
        if (rec.value.reserved === 'true' || rec.value.reserved === true ||
            Object.keys(rec.value).length > 2) {
            var ip = new IP(rec.value);
            ip.params.network_uuid = params.network_uuid;
            ips.push(ip);
        }
    });

    req.on('end', function _endNetList() {
        return callback(null, ips);
    });
}


/*
 * Get an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP number (required)
 * - `network_uuid`: Network UUID (required)
 * - `returnObject` {Boolean}: Return an IP object even if the record
 *   does not exist in moray (optional)
 * @param callback {Function} `function (err, ipObj)`
 */
function getIP(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;

    log.debug(params, 'getIP: entry');
    var ip = util_ip.toIPAddr(params.ip);
    if (!ip) {
        return callback(new restify.InvalidArgumentError(
            'Invalid IP %s', params.ip));
    }

    var ipBucket = common.getBucketObj(params.network_uuid);

    // XXX LEGACY: remove this after migration is complete
    vasync.parallel({
        funcs: [
            function _getIP(cb) {
                var key = ip.toString();
                mod_moray.getObj(app.moray, ipBucket, key, cb);
            },
            function _getIP_legacy(cb) {
                var key = util_ip.addressToNumber(ip.toString()).toString();
                mod_moray.getObj(app.moray, ipBucket, key, cb);
            }
        ]
    }, function (err, res) {
        if (res.nerrors >= 2) {
            var notFound = res.operations.every(function check404(o) {
                return o.err && o.err.statusCode === 404;
            });
            if (notFound) {
                if (opts.returnObject) {
                    return callback(null, new IP({
                        etag: null,
                        free: true,
                        ip: ip,
                        network_uuid: params.network_uuid,
                        reserved: false
                    }));
                }
                return callback(
                    new restify.ResourceNotFoundError('IP not found'));
            }
            return callback(res.operations[0].err);
        } else {
            // If both IP number and IP address succeed, that's spooky and
            // weird, but take whichever's the first success anyway.
            var success = res.successes[0];
            success.value.network_uuid = params.network_uuid;
            success.value.etag = success._etag;
            return callback(null, new IP(success.value));
        }
    });



    // mod_moray.getObj(app.moray, ipBucket, ip.toString(),
    //     function (err, rec) {
    //     if (err) {
    //         if (err.statusCode === 404) {
    //             if (opts.returnObject) {
    //                 return callback(null, new IP({
    //                     etag: null,
    //                     free: true,
    //                     ip: ip,
    //                     network_uuid: params.network_uuid,
    //                     reserved: false
    //                 }));
    //             }

    //             return callback(
    //                 new restify.ResourceNotFoundError('IP not found'));
    //         }

    //         return callback(err);
    //     }

    //     rec.value.network_uuid = params.network_uuid;
    //     rec.value.etag = rec._etag;
    //     return callback(null, new IP(rec.value));
    // });

}


/**
 * Updates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `belongs_to_type`: Belongs to type (optional)
 * - `belongs_to_uuid`: Belongs to UUID (optional)
 * - `ip`: IP address (required)
 * - `network_uuid`: Network UUID (required)
 * - `owner_uuid`: Owner UUID (optional)
 * - `reserved`: Reserved (optional)
 * @param callback {Function} `function (err, ipObj)`
 */
function updateIP(app, log, params, callback) {
    log.debug(params, 'updateIP: entry');
    var ip = util_ip.toIPAddr(params.ip);

    if (!ip) {
        return callback(new restify.InvalidArgumentError(
            'Invalid IP "%s"', params.ip));
    }

    var validateParams = {
        params: params,

        optional: {
            belongs_to_type: validate.string,
            belongs_to_uuid: validate.UUID,
            check_owner: validate.bool,
            owner_uuid: validate.UUID,
            reserved: validate.bool
        },

        required: {
            network: validateNetworkObj
        },

        after: validateNetworkOwner
    };

    // both belongs_to_type and belongs_to_uuid must be set in UFDS at the
    // same time.  If they are set, owner_uuid must be as well.
    if (params.hasOwnProperty('oldIP')) {
        if (params.belongs_to_uuid && !params.oldIP.belongs_to_type) {
            validateParams.required.belongs_to_type =
                validateParams.optional.belongs_to_type;
            delete validateParams.optional.belongs_to_type;
        }

        if (params.belongs_to_type && !params.oldIP.belongs_to_uuid) {
            validateParams.required.belongs_to_uuid =
                validateParams.optional.belongs_to_uuid;
            delete validateParams.optional.belongs_to_uuid;
        }

        if (!params.oldIP.owner_uuid && (params.belongs_to_type ||
            params.belongs_to_uuid)) {
            validateParams.required.owner_uuid =
                validateParams.optional.owner_uuid;
            delete validateParams.optional.owner_uuid;
        }
    }

    validate.params(validateParams, function (validationErr, validatedParams) {
        if (validationErr) {
            return callback(validationErr);
        }

        var updateOpts = {
            bucket: common.getBucketObj(params.network_uuid),
            key: ip.toString(),
            moray: app.moray,
            val: validatedParams
        };

        // XXX LEGACY: remove this after migration is complete
        if (validatedParams.network.legacy) {
            updateOpts.key = util_ip.addressToNumber(ip.toString()).toString();
        }

        // If unassigning, remove the 'belongs_to' information, but keep
        // owner and reserved
        if (params.unassign) {
            updateOpts.val = {
                belongs_to_type: true,
                belongs_to_uuid: true
            };
            updateOpts.remove = true;
        }

        // Don't add the entire network object to the moray record
        delete updateOpts.val.network;

        mod_moray.updateObj(updateOpts, function (err, rec) {
            if (err) {
                log.error({
                    err: err,
                    ip: params.ip.toString(),
                    opts: { val: updateOpts.val, remove: updateOpts.remove }
                }, 'Error updating IP');

                return callback(err);
            }

            rec.value.network_uuid = params.network_uuid;
            rec.value.etag = rec._etag;
            var newIP = new IP(rec.value);

            log.info({
                ip: params.ip.toString(),
                obj: newIP.serialize(),
                opts: { val: updateOpts.val, remove: updateOpts.remove }
            }, 'Updated IP');

            return callback(null, newIP);
        });
    });
}


/**
 * Creates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP address (required)
 * - `network_uuid`: Network UUID (required)
 * - `network`: Network object (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function createIP(app, log, params, callback) {
    log.debug(params, 'createIP: entry');

    var validateParams = {
        params: params,

        required: {
            ip: validate.IP,
            network: validateNetworkObj,
            // We've already validated this courtesy of whoever called us
            // (they would have used network_uuid to validate the network
            // object above), but we want it in the validated params to
            // put in the IP object:
            network_uuid: validate.UUID
        },

        optional: {
            check_owner: validate.bool,
            reserved: validate.bool
        },

        after: validateNetworkOwner
    };

    if (params.hasOwnProperty('belongs_to_uuid') ||
        params.hasOwnProperty('belongs_to_type')) {
        validateParams.required.belongs_to_uuid = validate.UUID;
        validateParams.required.belongs_to_type = validate.string;
        validateParams.required.owner_uuid = validate.UUID;
    }

    if (!validateParams.required.hasOwnProperty('owner_uuid')) {
        validateParams.optional.owner_uuid = validate.UUID;
    }

    validate.params(validateParams, function (validationErr, validated) {
        if (validationErr) {
            return callback(validationErr);
        }

        var ip;
        try {
            ip = new IP(validated);
        } catch (err) {
            log.error(err, 'addIP: error creating IP');
            return callback(err);
        }

        var key = ip.address.toString();
        // XXX LEGACY
        if (validated.network.legacy) {
            key = util_ip.addressToNumber(ip.address.toString()).toString();
        }

        var ipBucket = common.getBucketObj(validated.network.uuid);
        log.debug({ params: params, bucket: ipBucket }, 'addIP: creating IP');

        app.moray.putObject(ipBucket.name, key, ip.raw(),
            { etag: null }, function (err) {
            if (err) {
                log.error({
                    err: err,
                    ip: ip.address.toString(),
                    obj: ip.serialize()
                }, 'Error creating IP');

                return callback(err);
            }

            log.info({
                ip: ip.address.toString(),
                obj: ip.serialize()
            }, 'Created IP');

            return callback(null, ip);
        });
    });
}


/**
 * Create a new IP object using the parameters from the old object, plus
 * any updated parameters
 */
function createUpdatedObject(oldIP, params) {
    var updatedIpParams = oldIP.serialize();
    NIC_SHARED_PARAMS.forEach(function (p) {
        if (params.hasOwnProperty(p)) {
            updatedIpParams[p] = params[p];
        }
    });
    updatedIpParams.etag = oldIP.etag;

    return new IP(updatedIpParams);
}


/**
 * Creates an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `batch` {Array of Objects}
 * - `ip`: IP address (required)
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function batchCreateIPs(app, log, params, callback) {
    log.debug(params, 'batchCreateIPs: entry');
    var bucket = common.getBucketObj(params.network_uuid);
    var ips = [];

    var batchData = params.batch.map(function (ipParams) {
        var ip = new IP(ipParams);
        ips.push(ip);
        var key = ip.address.toString();
        // XXX LEGACY
        if (params.network.legacy) {
            key = util_ip.addressToNumber(ip.address.toString()).toString();
        }
        return {
            bucket : bucket.name,
            key: key,
            operation: 'put',
            value: ip.raw()
        };
    });

    log.info(batchData, 'batchCreateIPs: creating IPs');
    app.moray.batch(batchData, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null, ips);
    });
}


/*
 * Deletes an IP
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `ip`: IP number or address (required)
 * - `network_uuid`: Network UUID (required)
 * @param callback {Function} `function (err, ipObj)`
 */
function deleteIP(app, log, params, callback) {
    log.debug(params, 'deleteIP: entry');
    var ip = util_ip.toIPAddr(params.ip);
    if (!ip) {
        return callback(new restify.InvalidArgumentError(
            'Invalid IP "%s"', params.ip));
    }

    var key = ip.toString();

    if (params.network.legacy) {
        key = util_ip.addressToNumber(ip.toString()).toString();
    }

    log.info(params, 'deleteIP: deleting IP %s', ip.toString());
    mod_moray.updateObj({
        bucket: common.getBucketObj(params.network_uuid),
        key: key,
        moray: app.moray,
        replace: true,
        val: { ip: ip.toString(), reserved: false }
    }, function (err, res) {
        if (err) {
            log.error({
                err: err,
                ip: params.ip
            }, 'Error deleting IP');

        } else {
            log.info({
                ip: params.ip,
                raw: res.value
            }, 'Deleted IP');
        }

        return callback(err, res);
    });
}


/**
 * Extract all parameters necessary for IP creation from params and return
 * them in a new object
 */
function extractParams(params, override) {
    if (!override) {
        override = {};
    }

    var newParams = {};
    CREATE_PARAMS.forEach(function (s) {
        if (params.hasOwnProperty(s)) {
            newParams[s] = params[s];
        }

        if (override.hasOwnProperty(s)) {
            newParams[s] = override[s];
        }
    });

    return newParams;
}


/**
 * Initializes the nic tags bucket
 */
function initIPbucket(app, log, networkUUID, callback) {
    var ipBucket = common.getBucketObj(networkUUID);
    mod_moray.initBucket(app.moray, ipBucket, callback);
}



module.exports = {
    batchCreate: batchCreateIPs,
    bucket: common.getBucketObj,
    bucketInit: initIPbucket,
    bucketName: common.bucketName,
    create: createIP,
    createUpdated: createUpdatedObject,
    del: deleteIP,
    get: getIP,
    IP: common.IP,
    list: listNetworkIPs,
    nextIPonNetwork: require('./provision').nextIPonNetwork,
    params: extractParams,
    update: updateIP
};
