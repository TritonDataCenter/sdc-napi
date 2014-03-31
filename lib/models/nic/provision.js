/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: provisioning functions for nics and IPs
 */

var clone = require('clone');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_ip = require('../ip');
var mod_net = require('../network');
var restify = require('restify');
var util_common = require('../../util/common');



// --- Internal functions



/**
 * Create a new nic record in moray, failing if it already exists
 */
function createNic(app, log, mac, raw, callback) {
    app.moray.putObject(common.BUCKET.name, mac.toString(), raw, { etag: null },
        function (err) {
        if (err && err.name === 'EtagConflictError') {
            var dupErr = new errors.InvalidParamsError(
                'Invalid parameters',
                [ errors.duplicateParam('mac') ]);
            dupErr.duplicate = true;
            return callback(dupErr);
        }

        return callback(err);
    });
}



// --- Exported functions



/**
 * Provision a specific IP, not just the next free one
 */
function ip(app, log, params, callback) {
    var ipParams = {
        network: params.network,
        network_uuid: params.network.uuid,
        ip: params.ip
    };

    common.IP_PARAMS.forEach(function (p) {
        if (params.hasOwnProperty(p)) {
            ipParams[p] = params[p];
        }
    });

    mod_ip.get(app, log, ipParams, function (err, res) {
        if (err) {
            if (err.name === 'ResourceNotFoundError') {
                // Does not exist, so do a create
                return mod_ip.create(app, log, ipParams, callback);
            }

            return callback(err);
        }

        if (!params.no_owner_check && res.hasOwnProperty('belongs_to_uuid') &&
            res.belongs_to_uuid != app.config.ufdsAdminUuid) {
            return callback(new errors.InvalidParamsError(
                'Invalid parameters', [ errors.usedByParam('ip',
                    res.belongs_to_type, res.belongs_to_uuid) ]));
        }

        return mod_ip.update(app, log, ipParams, callback);
    });
}


/**
 * Provision an IP on a network
 */
function ipOnNetwork(app, log, params, callback) {
    var ipParams = {
        network: params.network,
        network_uuid: params.network.uuid
    };

    common.IP_PARAMS.forEach(function (p) {
        if (params.hasOwnProperty(p)) {
            ipParams[p] = params[p];
        }
    });

    return mod_ip.create(app, log, ipParams, callback);
}


/**
 * Provision an IP on a network
 */
function ipOnNetworkPool(app, log, params, callback) {
    var uuids = clone(params.network_pool.networks);

    function tryNetProvision() {
        var nextUUID = uuids.shift();
        if (!nextUUID) {
            return callback(new errors.InvalidParamsError('Invalid parameters',
                [ errors.invalidParam('network_uuid',
                    constants.POOL_FULL_MSG) ]));
        }

        log.debug('network pool %s: trying network %s',
            params.network_pool.uuid, nextUUID);

        mod_net.get(app, log, { uuid: nextUUID }, function (err, res) {
            if (err) {
                log.error(err, 'provisionIPonNetworkPool: error getting ' +
                    'network %s', nextUUID);
                return process.nextTick(tryNetProvision);
            }

            params.network = res;
            params.network_uuid = res.uuid;
            return ipOnNetwork(app, log, params, function (err2, res2) {
                if (err2) {
                    log.error(err2, 'provisionIPonNetworkPool: error ' +
                        'provisioning on network %s', nextUUID);
                    return process.nextTick(tryNetProvision);
                }

                return callback(null, res2);
            });
        });
    }

    tryNetProvision();
}


/**
 * Tries repeatedly to find a free MAC address to provision with
 */
function nic(app, log, startAt, raw, callback) {
    var tries = 0;
    var num = startAt;

    util_common.repeat(function (cb) {
        if (tries > constants.MAC_RETRIES) {
            log.error({ start: startAt, num: num, tries: tries },
                'Could not provision nic after %d tries', tries);
            return cb(new restify.InternalError('no more free MAC addresses'));
        }
        tries++;
        raw.mac = num;

        createNic(app, log, num, raw, function (err, res) {
            if (err) {
                if (err.duplicate) {
                    num++;
                    return cb(null, null, true);
                }

                return cb(err);
            }

            log.info({ start: startAt, num: num, tries: tries },
                'Provisioned nic after %d tries', tries);
            return cb(null, num);
        });
    }, callback);
}



module.exports = {
    createNic: createNic,
    ip: ip,
    ipOnNetwork: ipOnNetwork,
    ipOnNetworkPool: ipOnNetworkPool,
    nic: nic
};
