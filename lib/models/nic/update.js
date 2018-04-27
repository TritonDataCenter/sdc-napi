/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * nic model: updating
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_ip = require('../ip');
var mod_net = require('../network');
var mod_nicTag = require('../nic-tag');
var Nic = require('./obj').Nic;
var provision = require('./provision');
var util = require('util');
var vasync = require('vasync');
var validate = require('../../util/validate');



// --- GLOBALS



// Updatable nic params
var UPDATE_PARAMS = [
    'allow_dhcp_spoofing',
    'allow_ip_spoofing',
    'allow_mac_spoofing',
    'allow_restricted_traffic',
    'allow_unfiltered_promisc',
    'belongs_to_type',
    'belongs_to_uuid',
    'check_owner',
    'cn_uuid',
    'ip',
    'owner_uuid',
    'model',
    'network',
    'network_uuid',
    'nic_tag',
    'nic_tags_provided',
    'primary',
    'reserved',
    'state',
    'underlay',
    'vlan_id'
];


var UPDATE_SCHEMA = {
    required: {
        mac: validate.MAC
    },

    optional: {
        allow_dhcp_spoofing: validate.bool,
        allow_ip_spoofing: validate.bool,
        allow_mac_spoofing: validate.bool,
        allow_restricted_traffic: validate.bool,
        allow_unfiltered_promisc: validate.bool,
        belongs_to_type: validate.enum(common.BELONGS_TO_TYPES),
        belongs_to_uuid: validate.UUID,
        check_owner: validate.bool,
        cn_uuid: validate.UUID,
        ip: validate.IPv4,
        owner_uuid: validate.UUID,
        model: validate.string,
        network_uuid: common.validateIPv4Network,
        nic_tag: common.validateNicTag,
        nic_tags_available: mod_nicTag.validateExists.bind(null, false),
        nic_tags_provided: mod_nicTag.validateExists.bind(null, false),
        primary: validate.bool,
        reserved: validate.bool,
        state: validate.enum(common.VALID_NIC_STATES),
        underlay: validate.bool,
        vlan_id: validate.VLAN
    },

    after: [
        function copyParams(opts, original, parsed, cb2) {
            assert.object(opts.existingNic, 'existingNic');
            var oldNIC = opts.existingNic;

            if (!parsed.hasOwnProperty('ip') && oldNIC.ip !== null) {
                parsed._ip = oldNIC.ip;
            }

            if (!parsed.hasOwnProperty('network') && oldNIC.network !== null) {
                parsed.network = oldNIC.network;
                parsed.network_uuid = oldNIC.network.uuid;
            }

            common.validateNetworkParams(opts, original, parsed, cb2);
        },
        common.validateUnderlayServer
    ]
};


// --- Internal helpers



/**
 * Uses the updated parameters to create a new nic object in opts.nic and
 * add it to opts.batch
 */
function addUpdatedNic(opts, callback) {
    try {
        opts.nic = new Nic(getUpdatedNicParams(opts));
    } catch (nicErr) {
        // XXX: wrap this error with WError
        callback(nicErr);
        return;
    }

    if (opts.ips.length > 0) {
        assert.equal(opts.ips.length, 1, 'opts.ips.length === 1');
        opts.nic.ip = opts.ips[0];
        opts.nic.network = opts.nic.ip.params.network;
    }

    callback();
}


/**
 * Returns an object of the updatable nic params from opts.validated
 */
function getUpdatedNicParams(opts) {
    var updatedNicParams = opts.existingNic.serialize();

    UPDATE_PARAMS.forEach(function (p) {
        if (opts.validated.hasOwnProperty(p)) {
            updatedNicParams[p] = opts.validated[p];
        }
    });

    updatedNicParams.etag = opts.existingNic.etag;

    // save timestamps as milliseconds since epoch
    var createdDate = new Date(updatedNicParams.created_timestamp);
    updatedNicParams.created_timestamp = Number(createdDate);
    updatedNicParams.modified_timestamp = Date.now();

    return updatedNicParams;
}



// --- Internal functions in the update chain


/**
 * Validate update params
 */
function validateUpdateParams(opts, callback) {
    opts.log.trace('validateUpdateParams: entry');

    var uopts = {
        app: opts.app,
        log: opts.log,
        create: false,
        network_cache: new mod_net.NetworkCache(opts.app, opts.log),
        existingNic: opts.existingNic
    };

    validate.params(UPDATE_SCHEMA, uopts, opts.params, function (err, res) {
        opts.validated = res;

        opts.log.trace({ validated: res }, 'validated params');

        callback(err);
    });
}

function v6address(ip) {
    return ip.v6address;
}

/**
 * Provision any new IPs that we need, free old ones, and update NIC properties.
 */
function prepareUpdate(opts, callback) {

    opts.log.trace('provisionIP: entry');

    opts.nicFn = addUpdatedNic;
    opts.baseParams = mod_ip.params(getUpdatedNicParams(opts));

    /*
     * If we didn't have an address before or after the update,
     * there's nothing to do here.
     */
    if (!opts.validated.hasOwnProperty('_ip')) {
        callback();
        return;
    }

    var oldNIC = opts.existingNic;
    var oldIPs = oldNIC.ip !== null ? [ oldNIC.ip ] : [];
    var nicOwner = oldNIC.params.belongs_to_uuid;

    var ips = [ opts.validated._ip ];

    /*
     * When the cn_uuid of a fabric NIC changes, we need to generate
     * a shootdown so that CNs remove their now incorrect mappings.
     */
    var fabric = oldNIC.isFabric();
    var oldCN = oldNIC.params.cn_uuid;
    var newCN = opts.validated.cn_uuid;
    if (fabric && newCN && oldCN !== newCN) {
        opts.shootdownNIC = true;
    }

    opts._removeIPs = [];

    var newAddrs = ips.map(v6address);
    var oldAddrs = oldIPs.map(v6address);

    oldIPs.forEach(function (oldIP) {
        // Avoid freeing if IP ownership has changed underneath us.
        if (newAddrs.indexOf(oldIP.v6address) === -1 &&
            nicOwner === oldIP.params.belongs_to_uuid) {
            opts._removeIPs.push(oldIP);
        }
    });

    // Check that all IPs we're adding are okay to use.
    vasync.forEachPipeline({
        'inputs': ips.filter(function (newIP) {
            return (oldAddrs.indexOf(newIP.v6address) === -1);
        }),
        'func': function checkProvisionable(ip, cb) {
            if (ip.provisionable()) {
                cb();
                return;
            }

            var oldUsedErr = new errors.InvalidParamsError(
                constants.msg.INVALID_PARAMS, [ errors.usedByParam('ip',
                    ip.params.belongs_to_type, ip.params.belongs_to_uuid,
                    util.format(constants.fmt.IP_IN_USE,
                        ip.params.belongs_to_type,
                        ip.params.belongs_to_uuid))
                ]);
            cb(oldUsedErr);
        }
    }, callback);
}


// --- Exports


/**
 * Updates a nic with the given parameters
 */
function update(opts, callback) {
    opts.log.trace('nic.update: entry');

    vasync.pipeline({
        arg: opts,
        funcs: [
            validateUpdateParams,
            prepareUpdate,
            provision.nicAndIP
        ]
    }, function (err) {
        if (err) {
            opts.log.error({
                before: opts.existingNic ?
                    opts.existingNic.serialize() : '<does not exist>',
                err: err,
                params: opts.validated
            }, 'Error updating nic');

            callback(err);
            return;
        }

        opts.log.info({
            before: opts.existingNic.serialize(),
            params: opts.params,
            after: opts.nic.serialize()
        }, 'Updated nic');

        callback(null, opts.nic);
    });
}



module.exports = {
    update: update
};
