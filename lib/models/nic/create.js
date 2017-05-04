/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * nic model: creation
 */

'use strict';

var common = require('./common');
var mod_net = require('../network');
var mod_nicTag = require('../nic-tag');
var provision = require('./provision');
var validate = require('../../util/validate');
var vasync = require('vasync');



// --- Internal


var CREATE_SCHEMA = {
    required: {
        belongs_to_uuid: validate.UUID,
        belongs_to_type: validate.enum(common.BELONGS_TO_TYPES),
        owner_uuid: validate.UUID
    },

    optional: {
        allow_dhcp_spoofing: validate.bool,
        allow_ip_spoofing: validate.bool,
        allow_mac_spoofing: validate.bool,
        allow_restricted_traffic: validate.bool,
        allow_unfiltered_promisc: validate.bool,
        check_owner: validate.bool,
        cn_uuid: validate.UUID,
        ip: validate.IPv4,
        mac: validate.MAC,
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
        common.validateNetworkParams,
        common.validateFabricNic,
        common.validateUnderlayServer
    ]
};


/**
 * Validate creation parameters
 */
function validateParams(opts, callback) {
    var copts = {
        app: opts.app,
        log: opts.log,
        network_cache: new mod_net.NetworkCache(opts.app, opts.log),
        create: true
    };

    validate.params(CREATE_SCHEMA, copts, opts.params, function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        opts.validated = res;
        opts.log.debug({ validated: opts.validated },
            'validated network params');
        callback();
    });
}

// --- Exports


/**
 * Creates a new Nic (and optionally a new IP with it)
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `owner_uuid` {UUID}: Owner (required)
 * - `belongs_to_uuid` {UUID}: UUID of object this nic belongs to (required)
 * - `belongs_to_type` {String}: type of object this nic belongs to (required)
 * - `mac` {String}: MAC address to use. If not specified, one will be
 *   generated
 * - `ip` {IP}: IP address
 * - `network_uuid` {UUID}: network to create the IP on
 * - `primary` {Bool}: whether the network is primary or not
 * - `nic_tags_provided` {Array}: names of nic tags this physical nic provides
 * - `state` {String}: current state of NIC (e.g. running)
 *
 * If ip is specified in params, but not network_uuid, the following params
 * can be used to search for a network to create the IP on:
 * - `vlan` {Number}: VLAN ID
 * - `nic_tag` {String}: nic tag name
 * @param callback {Function} `function (err, nic)`
 */
function create(opts, callback) {
    vasync.pipeline({
        arg: opts,
        funcs: [
            validateParams,
            provision.addParams,
            provision.nicAndIP
        ]
    }, function (err) {
        callback(err, opts.nic);
    });
}


module.exports = {
    create: create
};
