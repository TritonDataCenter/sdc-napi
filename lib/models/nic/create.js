/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: creation
 */

var common = require('./common');
var mod_ip = require('../ip');
var mod_nicTag = require('../nic-tag');
var Nic = require('./obj').Nic;
var provision = require('./provision');
var restify = require('restify');
var util_mac = require('../../util/mac');
var validate = require('../../util/validate');
var vasync = require('vasync');



// --- Exported functions



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
 * - `status` {String}: current state of NIC (e.g. running)
 *
 * If ip is specified in params, but not network_uuid, the following params
 * can be used to search for a network to create the IP on:
 * - `vlan` {Number}: VLAN ID
 * - `nic_tag` {String}: nic tag name
 * @param callback {Function} `function (err, nic)`
 */
function create(app, log, params, callback) {
    log.debug(params, 'nic create: entry');
    var ip;
    var nic;
    var validated;

    vasync.pipeline({
        funcs: [
            function _validateParams(_, cb) {
                delete params.network;

                var toValidate = {
                    params: params,

                    required: {
                        belongs_to_uuid: validate.UUID,
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
                        ip: validate.IP,
                        mac: validate.MAC,
                        model: validate.string,
                        network_uuid: common.validateNetwork.bind(null, app,
                            log),
                        nic_tag:
                            mod_nicTag.validateExists.bind(null, app, log,
                                true),
                        nic_tags_provided:
                            mod_nicTag.validateExists.bind(null, app, log,
                                false),
                        primary: validate.bool,
                        reserved: validate.bool,
                        status: validate.status,
                        vlan_id: validate.VLAN
                    },

                    after: common.validateNetworkParams.bind(null, app, log)
                };

                validate.params(toValidate, function (err, res) {
                    if (err) {
                        return cb(err);
                    }

                    validated = res;
                    return cb();
                });
            },

            // Create or provision the IP
            function _ip(_, cb) {
                var provFn;

                if (validated.network_pool) {
                    provFn = provision.ipOnNetworkPool;
                } else if (validated.network) {
                    provFn = validated.ip ? provision.ip :
                        provision.ipOnNetwork;
                }

                if (!provFn) {
                    return cb(null);
                }

                return provFn(app, log, validated, function (err, res) {
                    if (res) {
                        ip = res;
                    }

                    return cb(err);
                });
            },

            // Now create the nic
            function _createProvisionNic(_, cb) {
                var haveMAC = validated.hasOwnProperty('mac');
                if (!haveMAC) {
                    // If no MAC specified, generate a random one based
                    // on the OUI in the config
                    validated.mac = util_mac.randomNum(app.config.macOUI);
                }

                try {
                    nic = new Nic(validated);
                } catch (err) {
                    return cb(new restify.InvalidArgumentError(err.message));
                }

                if (validated.network) {
                    nic.network = validated.network;
                }

                if (ip) {
                    nic.ip = ip;
                }

                if (haveMAC) {
                    // User requested a MAC - try to provision with it
                    return provision.createNic(app, log, nic.mac, nic.raw(),
                        cb);
                }

                // No MAC requested a MAC - generate a random one and retry
                // if it's taken
                provision.nic(app, log, nic.mac, nic.raw(),
                    function (err, mac) {
                    if (err) {
                        return cb(err);
                    }

                    nic.mac = mac;
                    return cb();
                });
            }
        ]
    }, function (err, res) {
        if (err) {
            if (!ip) {
                return callback(err);
            }

            // IP was provisioned but we failed to create a nic
            var delParams = {
                network_uuid: validated.network.uuid,
                ip: ip.number
            };
            return mod_ip.del(app, log, delParams, function (err2) {
                if (err2) {
                    return callback(err2);
                }

                return callback(err);
            });
        }

        return callback(null, nic);
    });
}



module.exports = {
    create: create
};
