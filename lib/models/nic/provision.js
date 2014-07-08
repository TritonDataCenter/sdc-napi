/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: provisioning functions for nics and IPs
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_ip = require('../ip');
var mod_net = require('../network');
var Nic = require('./obj').Nic;
var restify = require('restify');
var util = require('util');
var util_common = require('../../util/common');
var util_mac = require('../../util/mac');
var vasync = require('vasync');



// --- Internal functions



/**
 * Calls the next IP provisioning function, but prevents stop errors
 * from stopping the provisioning loop.
 */
function addNextIP(opts, callback) {
    mod_ip.nextIPonNetwork(opts, function (err) {
        if (err && err.stop) {
            delete err.stop;
        }

        return callback(err);
    });
}


/**
 * Provision a specific IP on a network
 */
function ipOnNetwork(opts, callback) {
    assert.object(opts.ipParams, 'opts.ipParams');

    var params = opts.validated;
    var ipBucket = mod_ip.bucket(params.network_uuid);

    if (opts.ip && opts.err && opts.err.context &&
        opts.err.context.bucket == ipBucket.name) {
        var usedErr = new errors.InvalidParamsError(errors.msg.invalidParam,
            [ errors.duplicateParam('ip', util.format(
                constants.fmt.IP_EXISTS, params.network_uuid)) ]);
        usedErr.stop = true;
        return callback(usedErr);
    }

    if (opts.ipParams.hasOwnProperty('_ip')) {
        // The IP already exists in moray, but isn't taken by someone else
        opts.ip = mod_ip.createUpdated(opts.ipParams._ip, opts.ipParams);
    } else {
        opts.ip = new mod_ip.IP(opts.ipParams);
    }

    opts.batch.push(opts.ip.batch());

    return callback();
}


/**
 * Provision an IP on a network pool
 */
function ipOnNetworkPool(opts, callback) {
    var params = opts.validated;

    if (!opts.poolUUIDs) {
        opts.poolUUIDs = clone(params.network_pool.networks);
        opts.log.debug({ poolUUIDs: opts.poolUUIDs },
            'ipOnNetworkPool: network list');
    }

    var haveNetErr = (opts.err && opts.err.context ==
        mod_ip.bucketName(params.network_uuid));

    // We've been through this function before, but the problem wasn't us -
    // just allow nextIPonNetwork() to handle things
    if (params.network && !haveNetErr) {
        return addNextIP(opts, callback);
    }

    if (!params.network || haveNetErr) {
        var nextUUID = opts.poolUUIDs.shift();
        if (!nextUUID) {
            var fullErr = new errors.InvalidParamsError('Invalid parameters',
                [ errors.invalidParam('network_uuid',
                    constants.POOL_FULL_MSG) ]);
            fullErr.stop = true;
            return callback(fullErr);
        }

        opts.log.debug({ nextUUID: nextUUID }, 'Trying next network in pool');

        return mod_net.get(opts.app, opts.log, { uuid: nextUUID },
            function (err, res) {
            if (err) {
                opts.log.error(err, 'provisionIPonNetworkPool: error getting ' +
                    'network %s', nextUUID);
                return callback(err);
            }

            // Add the correct network params to the provisioning params
            // object:
            opts.validated.network = res;
            opts.validated.network_uuid = res.uuid;
            opts.ipParams = mod_ip.params(opts.validated);

            // XXX: reset IP properties here
            // XXX: refactor into a mod_ip.removeIPproperties?
            delete opts.ipProvisionTries;
            delete opts.noMoreGapIPs;

            return addNextIP(opts, callback);
        });
    }

    return addNextIP(opts, callback);
}


/**
 * Adds an opts.nic with the MAC address from opts.validated, and adds its
 * batch item to opts.batch.  Intended to be passed to nicAndIP() in
 * opts.nicFn.
 */
function macSupplied(opts, callback) {
    // We've already tried provisioning once, and it was the nic that failed:
    // no sense in retrying
    if (opts.nic && opts.err && opts.err.context &&
        opts.err.context.bucket == common.BUCKET.name) {

        var usedErr = new errors.InvalidParamsError(errors.msg.invalidParam,
            [ errors.duplicateParam('mac') ]);
        usedErr.stop = true;
        return callback(usedErr);
    }

    opts.nic = new Nic(opts.validated);
    if (opts.ip) {
        opts.nic.ip = opts.ip;
        opts.nic.network = opts.validated.network;
    }
    addNicToBatch(opts);

    return callback();
}


/**
 * Adds an opts.nic with a random MAC address, and adds its batch item to
 * opts.batch.  Intended to be passed to nicAndIP() in opts.nicFn.
 */
function randomMAC(opts, callback) {
    var validated = opts.validated;

    if (!opts.hasOwnProperty('macTries')) {
        opts.macTries = 0;
    }

    // If we've already supplied a MAC address and the error isn't for our
    // bucket, we don't need to generate a new MAC - just re-add the existing
    // nic to the batch
    if (validated.mac && (!opts.err || !opts.err.hasOwnProperty('context') ||
        opts.err.context.bucket != 'napi_nics')) {

        opts.nic = new Nic(validated);
        if (opts.ip) {
            opts.nic.ip = opts.ip;
            opts.nic.network = opts.validated.network;
        }

        addNicToBatch(opts);
        return callback();
    }

    if (opts.macTries > constants.MAC_RETRIES) {
        opts.log.error({ start: opts.startMac, num: validated.mac,
            tries: opts.macTries },
            'Could not provision nic after %d tries', opts.macTries);
        var err = new restify.InternalError('no more free MAC addresses');
        err.stop = true;
        return callback(err);
    }

    opts.macTries++;

    if (!opts.maxMac) {
        opts.maxMac = util_mac.maxOUInum(opts.app.config.macOUI);
    }

    if (!validated.mac) {
        validated.mac = util_mac.randomNum(opts.app.config.macOUI);
        opts.startMac = validated.mac;
    } else {
        validated.mac++;
    }

    if (validated.mac > opts.maxMac) {
        // We've gone over the maximum MAC number - start from a different
        // random number
        validated.mac = util_mac.randomNum(opts.app.config.macOUI);
    }

    opts.nic = new Nic(validated);
    if (opts.ip) {
        opts.nic.ip = opts.ip;
        opts.nic.network = opts.validated.network;
    }

    addNicToBatch(opts);
    return callback();
}



// --- Exported functions



/**
 * Adds parameters to opts for provisioning a nic and an optional IP
 */
function addParams(opts, callback) {
    opts.nicFn = opts.validated.mac ? macSupplied : randomMAC;
    opts.ipParams = mod_ip.params(opts.validated);
    if (opts.validated.hasOwnProperty('_ip')) {
        opts.ipParams._ip = opts.validated._ip;
    }

    return callback();
}


/**
 * Add the batch item for the nic in opts.nic opts.batch, as well as an
 * item for unsetting other primaries owned by the same owner, if required.
 */
function addNicToBatch(opts) {
    opts.batch.push(opts.nic.batch());

    if (opts.nic.params.primary) {
        opts.batch.push({
            bucket: common.BUCKET.name,
            fields: {
                primary_flag: 'false'
            },
            filter: util.format('(&(belongs_to_uuid=%s)(!(mac=%d)))',
                opts.nic.params.belongs_to_uuid, opts.nic.mac),
            operation: 'update'
        });
    }
}


/**
 * Commits opt.batch to moray
 */
function commitBatch(opts, callback) {
    opts.log.info({ batch: opts.batch }, 'batch: commit');
    opts.app.moray.batch(opts.batch, function (err) {
        if (err) {
            opts.log.error(err, 'batch error');
        }

        return callback(err);
    });
}


/**
 * Provisions a nic and optional IP
 *
 * @param opts {Object}:
 * - ipParams {Object}: parameters used for creating the IP (required)
 * - nicFn {Function}: function that populates opts.nic and adds its
 *       batch item(s) to opts.batch (required)
 */
function nicAndIP(opts, callback) {
    assert.object(opts.ipParams, 'opts.ipParams');
    assert.ok(opts.nicFn, 'opts.nicFn');

    var before = process.hrtime();
    var funcs = [ ];
    var params = opts.validated;

    if (params.network_pool) {
        funcs.push(ipOnNetworkPool);
    } else if (params.network) {
        if (params.ip) {
            // Want a specific IP
            funcs.push(ipOnNetwork);
        } else {
            // Just provision the next IP on the network
            funcs.push(mod_ip.nextIPonNetwork);
        }
    }

    opts.log.debug({
        nicProvFn: opts.nicFn.name,
        // We could only be provisioning a nic:
        ipProvFn: funcs.length === 0 ? 'none' : funcs[0].name,
        ipParams: opts.ipParams,
        validated: opts.validated
    }, 'provisioning');

    // This function needs to go after the IP provisioning functions in the
    // chain, as the nic needs a pointer to what IP address it has
    funcs.push(opts.nicFn);
    funcs.push(commitBatch);

    util_common.repeat(function (cb) {
        // Reset opts.batch - it is the responsibility for functions in the
        // pipeline to re-add their batch data each time through the loop
        opts.batch = [];

        vasync.pipeline({
            arg: opts,
            funcs: funcs
        }, function (err) {
            if (err) {
                if (err.stop) {
                    // No more to be done:
                    return cb(err, null, false);
                }

                // Need to retry. Set opts.err so the functions in funcs
                // can determine if they need to change their params
                opts.err = err;
                return cb(null, null, true);
            }

            return cb(null, opts.nic, false);
        });
    }, function (err, res) {
        var after = process.hrtime(before);
        var took = Math.floor((1000000 * after[0]) + (after[1] / 1000));

        if (err) {
            opts.log.error({ err: err, params: opts.params,
                provisionTime: took }, 'Error creating nic');
            return callback(err);
        }

        opts.log.info({ params: params, obj: res.serialize(),
            provisionTime: took }, 'Created nic');

        return callback(null, res);
    });
}




module.exports = {
    addParams: addParams,
    addNicToBatch: addNicToBatch,
    commitBatch: commitBatch,
    nicAndIP: nicAndIP
};
