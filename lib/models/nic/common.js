/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model: common code
 */

var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_ip = require('../ip');
var mod_net = require('../network');
var mod_pool = require('../network-pool');
var util = require('util');
var util_mac = require('../../util/mac');
var validate = require('../../util/validate');



// --- Globals

var BUCKET = require('./bucket').BUCKET;


// --- Internal helpers



/**
 * Validates a MAC address
 */
function validateMAC(name, mac, callback) {
    var macNum = util_mac.macAddressToNumber(mac);
    if (!macNum) {
        return callback(errors.invalidParam(name,
            'invalid MAC address'));
    }

    return callback(null, macNum);
}


/**
 * Validates a network UUID and ensures that the network exists
 */
function validateNetworkPool(app, log, name, uuid, callback) {
    mod_pool.get(app, log, { uuid: uuid }, function (err2, res) {
        if (err2) {
            if (err2.name === 'ResourceNotFoundError') {
                return callback(errors.invalidParam(name,
                    'network does not exist'));
            }

            return callback(err2);
        }

        var toReturn = {
            network_pool: res
        };
        toReturn[name] = res.uuid;
        return callback(null, null, toReturn);
    });
}


/**
 * Validates a network UUID
 */
function validateNetworkUUID(name, uuid, callback) {
    if (uuid === 'admin') {
        return callback(null, uuid);
    }

    return validate.UUID(name, uuid, callback);
}


/**
 * Validate that the subnet contains the IP address
 */
function validateSubnetContainsIP(opts, parsedParams, callback) {
    var app = opts.app;
    var log = opts.log;

    if (!parsedParams.ip.match(
        parsedParams.network.subnetStart, parsedParams.network.subnetBits)) {

        return callback(errors.invalidParam('ip', constants.msg.IP_OUTSIDE));
    }

    var getOpts = {
        app: app,
        log: log,
        params: parsedParams,
        // If it's missing in moray, return an object anyway:
        returnObject: true
    };
    mod_ip.get(getOpts, function (err, res) {
        if (err) {
            // XXX : return different error here
            return callback(err);
        }

        // Don't allow taking another nic's IP on create if it's taken by
        // something else (server, zone)
        if (opts.create && !res.provisionable()) {
            return callback(errors.usedByParam('ip',
                res.params.belongs_to_type,
                res.params.belongs_to_uuid,
                util.format(constants.fmt.IP_IN_USE,
                    res.params.belongs_to_type,
                    res.params.belongs_to_uuid)));
        }

        parsedParams._ip = res;
        return callback();
    });
}



// --- Exported functions



/**
 * Validates a network UUID and ensures that the network exists
 */
function validateNetwork(app, log, name, uuid, callback) {
    validateNetworkUUID(name, uuid, function (err) {
        if (err) {
            return callback(err);
        }

        mod_net.get({ app: app, log: log, params: { uuid: uuid } },
                function (err2, res) {
            if (err2) {
                if (err2.name === 'ResourceNotFoundError') {
                    return validateNetworkPool(app, log, name, uuid, callback);
                }

                return callback(err2);
            }

            var toReturn = {
                network: res
            };
            toReturn[name] = res.uuid;
            return callback(null, null, toReturn);
        });
    });
}


/**
 * Validate that the network parameters are valid
 */
function validateNetworkParams(opts, params, parsedParams, callback) {
    var app = opts.app;
    var log = opts.log;

    // Not allowed to provision an IP on a network pool
    if (parsedParams.ip && parsedParams.network_pool) {
        return callback(errors.invalidParam('ip', constants.POOL_IP_MSG));
    }

    if (params.hasOwnProperty('network_uuid') &&
        !parsedParams.hasOwnProperty('network')) {
        // network validation has failed - we've already returned an invalid
        // parameter error
        return callback();
    }

    // If the networks has owner_uuids, make sure we match one of them (or
    // the UFDS admin UUID). Don't check if check_owner is set to false.
    if (parsedParams.network && parsedParams.owner_uuid &&
        (!parsedParams.hasOwnProperty('check_owner') ||
        parsedParams.check_owner) &&
        !parsedParams.network.isOwner(parsedParams.owner_uuid)) {
        return callback(errors.invalidParam('owner_uuid',
            constants.OWNER_MATCH_MSG));
    }

    // network_uuid and ip were specified, so just validate
    if (parsedParams.ip && parsedParams.network) {
        return validateSubnetContainsIP(opts, parsedParams, callback);
    }

    if (!parsedParams.ip) {
        return callback();
    }

    // ip specified, but not network_uuid: vlan_id and nic_tag are needed to
    // figure out what network the nic is on
    var errs = [];
    ['nic_tag', 'vlan_id'].forEach(function (p) {
        if (!parsedParams.hasOwnProperty('vlan_id')) {
            errs.push(errors.missingParam(p, constants.msg.IP_NO_VLAN_TAG));
        }
    });

    if (errs.length !== 0) {
        return callback(errs);
    }

    var query = {
        vlan_id: parsedParams.vlan_id,
        nic_tag: parsedParams.nic_tag
    };

    return mod_net.list({ app: app, log: log, params: query },
            function (err, res) {
        if (err) {
            return callback(err);
        }

        if (res.length === 0) {
            return callback(['nic_tag', 'vlan_id'].map(function (p) {
                return errors.invalidParam(p,
                'No networks found matching parameters');
            }));
        }

        if (res.length !== 1) {
            return callback(['nic_tag', 'vlan_id'].map(function (p) {
                return errors.invalidParam(p,
                'Too many networks found matching parameters');
            }));
        }

        parsedParams.network = res[0];
        parsedParams.network_uuid = res[0].uuid;

        return validateSubnetContainsIP(opts, parsedParams, callback);
    });
}



module.exports = {
    BUCKET: BUCKET,
    validateMAC: validateMAC,
    validateNetwork: validateNetwork,
    validateNetworkParams: validateNetworkParams
};
