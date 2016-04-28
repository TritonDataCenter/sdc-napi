/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model: creation
 */

'use strict';

var common = require('./common');
var mod_nicTag = require('../nic-tag');
var provision = require('./provision');
var validate = require('../../util/validate');
var vasync = require('vasync');



// --- Internal



/**
 * Validate creation parameters
 */
function validateParams(opts, callback) {
    var params = opts.params;
    delete params.network;

    var toValidate = {
        params: params,

        required: {
            belongs_to_uuid: validate.UUID,
            // XXX: tighten up the type validation here
            belongs_to_type: validate.string,
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
            ip: validate.IP,
            mac: validate.MAC,
            model: validate.string,
            network_uuid: common.validateNetwork.bind(null, opts.app,
                opts.log),
            nic_tag:
                mod_nicTag.validateExists.bind(null, opts.app, opts.log,
                    true),
            nic_tags_provided:
                mod_nicTag.validateExists.bind(null, opts.app, opts.log,
                    false),
            primary: validate.bool,
            reserved: validate.bool,
            state: validate.nicState,
            underlay: validate.bool,
            vlan_id: validate.VLAN
        },

        after: common.validateNetworkParams.bind(null,
            { app: opts.app, log: opts.log, create: true })
    };

    validate.params(toValidate, function (err, res) {
        if (err) {
            return callback(err);
        }

        opts.validated = res;
        opts.log.debug({ validated: opts.validated },
            'validated network params');
        return callback();
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
        if (err) {
            return callback(err);
        }
        return callback(null, opts.nic);
    });
}


module.exports = {
    create: create
};
