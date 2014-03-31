/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: common code
 */

var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_net = require('../network');
var mod_pool = require('../network-pool');
var util_mac = require('../../util/mac');
var validate = require('../../util/validate');



// --- Globals



// Boolean nic parameters: if it's true, display it when serializing.  If
// it's false, don't serialize it.
var BOOL_PARAMS = ['allow_dhcp_spoofing', 'allow_ip_spoofing',
    'allow_mac_spoofing', 'allow_restricted_traffic',
    'allow_unfiltered_promisc'];
var BUCKET = {
    desc: 'nic',
    name: 'napi_nics',
    schema: {
        index: {
            belongs_to_type: { type: 'string' },
            belongs_to_uuid: { type: 'string' },
            ip: { type: 'number' },
            mac: { type: 'number', unique: true },
            nic_tag: { type: 'string' },
            nic_tags_provided: { type: 'string' },
            owner_uuid: { type: 'string' }
        }
    }
};
// Parameters that can be passed to the various functions in the IP model
var IP_PARAMS = [
    'belongs_to_type',
    'belongs_to_uuid',
    'check_owner',
    'owner_uuid',
    'reserved'
];



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
        return callback(null, toReturn);
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
function validateSubnetContainsIP(parsedParams, callback) {
    if (parsedParams.ip < parsedParams.network.minIP ||
            parsedParams.ip > parsedParams.network.maxIP) {
        return callback(errors.invalidParam('ip',
            'ip cannot be outside subnet'));
    }

    return callback();
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

        mod_net.get(app, log, { uuid: uuid }, function (err2, res) {
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
            return callback(null, toReturn);
        });
    });
}


/**
 * Validate that the network parameters are valid
 */
function validateNetworkParams(app, log, params, parsedParams, callback) {
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
        return validateSubnetContainsIP(parsedParams, callback);
    }

    if (!parsedParams.ip) {
        return callback();
    }

    // ip specified, but not network_uuid: vlan_id and nic_tag are needed to
    // figure out what network the nic is on
    var errs = [];
    ['nic_tag', 'vlan_id'].forEach(function (p) {
        if (!parsedParams.hasOwnProperty('vlan_id')) {
            errs.push(errors.missingParam(p,
                'required if IP specified but not network_uuid'));
        }
    });

    if (errs.length !== 0) {
        return callback(errs);
    }

    var query = {
        vlan_id: parsedParams.vlan_id,
        nic_tag: parsedParams.nic_tag
    };

    return mod_net.list(app, log, query, function (err, res) {
        if (err) {
            return callback(err);
        }

        if (res.length === 0) {
            return callback(['nic_tag', 'vlan_id'].map(function (p) {
                return errors.invalidParam(p,
                'No networks found matching parameters');
            }));
        }

        if (res.length != 1) {
            return callback(['nic_tag', 'vlan_id'].map(function (p) {
                return errors.invalidParam(p,
                'Too many networks found matching parameters');
            }));
        }

        parsedParams.network = res[0];
        parsedParams.network_uuid = res[0].uuid;

        return validateSubnetContainsIP(parsedParams, callback);
    });
}



module.exports = {
    BOOL_PARAMS: BOOL_PARAMS,
    BUCKET: BUCKET,
    IP_PARAMS: IP_PARAMS,
    validateMAC: validateMAC,
    validateNetwork: validateNetwork,
    validateNetworkParams: validateNetworkParams
};
