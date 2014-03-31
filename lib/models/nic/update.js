/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic model: updating
 */

var common = require('./common');
var get = require('./get');
var getNic = require('./get').get;
var mod_ip = require('../ip');
var mod_moray = require('../../apis/moray');
var mod_nicTag = require('../nic-tag');
var Nic = require('./obj').Nic;
var provision = require('./provision');
var vasync = require('vasync');
var validate = require('../../util/validate');



// --- Exports



/**
 * Updates a nic with the given parameters
 */
function update(app, log, params, callback) {
    log.debug(params, 'nic:update: entry');

    var changingIP = false;
    var ip;
    var oldNic;
    var updatedNic;
    var updateParams;

    vasync.pipeline({
        funcs: [
            function _getOldNic(_, cb) {
                getNic(app, log, params, function (err, res) {
                    if (err) {
                        return cb(err);
                    }

                    oldNic = res;
                    return cb();
                });
            },

            function _validate(_, cb) {
                validate.params({
                    params: params,

                    required: {
                        mac: common.validateMAC
                    },

                    optional: {
                        allow_dhcp_spoofing: validate.bool,
                        allow_ip_spoofing: validate.bool,
                        allow_mac_spoofing: validate.bool,
                        allow_restricted_traffic: validate.bool,
                        allow_unfiltered_promisc: validate.bool,
                        belongs_to_type: validate.string,
                        belongs_to_uuid: validate.UUID,
                        check_owner: validate.bool,
                        ip: validate.IP,
                        owner_uuid: validate.UUID,
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

                    after: function (original, parsed, cb2) {
                        // Only add the old IP's network if we're not
                        // updating to a new network
                        if (!parsed.hasOwnProperty('network') && oldNic &&
                            oldNic.hasOwnProperty('network')) {
                            parsed.network = oldNic.network;
                            parsed.network_uuid = oldNic.network.uuid;
                        }

                        common.validateNetworkParams(app, log, original,
                            parsed, cb2);
                    }
                }, function (err, res) {
                    updateParams = res;

                    if (updateParams &&
                        updateParams.hasOwnProperty('nic_tags_provided')) {
                        updateParams.nic_tags_provided = mod_moray.arrayToVal(
                            updateParams.nic_tags_provided);
                    }

                    return cb(err);
                });
            },

            // If network_uuid was specified in the request, provision an
            // IP on that network
            function _provisionIP(_, cb) {
                // Don't use updateParams here - network gets added in the after
                // function above
                if (!params.network_uuid) {
                    return cb();
                }

                // If we already have an IP and we're not changing it,
                // don't provision a new one
                if (oldNic && oldNic.params.ip && (!params.ip ||
                    (params.ip === oldNic.params.ip))) {
                    return cb();
                }

                var ipParams = {
                    network: updateParams.network,
                    network_uuid: updateParams.network_uuid
                };

                common.IP_PARAMS.forEach(function (p) {
                    if (oldNic && oldNic.params.hasOwnProperty(p)) {
                        ipParams[p] = oldNic.params[p];
                    }
                    if (updateParams.hasOwnProperty(p)) {
                        ipParams[p] = updateParams[p];
                    }
                });

                var provFn = provision.ipOnNetwork;

                if (oldNic && oldNic.params.ip && params.ip) {
                    provFn = provision.ip;
                    ipParams.ip = updateParams.ip;
                    ipParams.no_owner_check = true;
                    changingIP = true;
                }

                return provFn(app, log, ipParams, function (err, res) {
                    if (res) {
                        ip = res;
                        updateParams.ip = ip.number;
                    }

                    return cb(err);
                });
            },

            function _updateNic(_, cb) {
                log.debug(updateParams, 'Updating nic "%s"', params.mac);

                var updateOpts = {
                    bucket: common.BUCKET,
                    key: updateParams.mac.toString(),
                    moray: app.moray,
                    replace: true,
                    val: oldNic.raw()
                };

                Object.keys(updateParams).forEach(function (p) {
                    // If one of the boolean params is false, don't add it
                    if (common.BOOL_PARAMS.indexOf(p) !== -1 &&
                        !updateParams[p]) {
                        delete updateOpts.val[p];
                        return;
                    }

                    updateOpts.val[p] = updateParams[p];
                });

                delete updateOpts.val.network;

                mod_moray.updateObj(updateOpts, function (err, rec) {
                    if (err) {
                        return cb(err);
                    }

                    try {
                        updatedNic = new Nic(rec.value);
                    } catch (err2) {
                        return cb(err2);
                    }

                    return cb();
                });
            },

            // Update the IP associated with the nic (unless we provisioned
            // an IP above)
            function _updateIP(_, cb) {
                if (ip && !changingIP) {
                    // We created the IP already - no need to update
                    return cb();
                }

                if (!oldNic || !oldNic.hasOwnProperty('ip') ||
                    !oldNic.hasOwnProperty('network')) {
                    if (oldNic) {
                        log.debug(oldNic.serialize(), 'nic "%s" before ' +
                            'update missing ip or network: not updating IP',
                            params.mac);
                    } else {
                        log.debug('No previous nic for "%s": not updating IP',
                            params.mac);
                    }

                    return cb();
                }

                // If updating to a new IP and the old IP has the same owner,
                // free it back into the pool
                if (updateParams.ip && (updateParams.ip !== oldNic.params.ip) &&
                    (oldNic.ip.params.belongs_to_uuid ===
                    oldNic.params.belongs_to_uuid)) {
                    var delParams = {
                        ip: oldNic.params.ip,
                        network_uuid: oldNic.params.network_uuid
                    };

                    return mod_ip.del(app, log, delParams, function (err) {
                        if (err) {
                            return cb(err);
                        }

                        log.debug(updateParams, 'nic:update: old IP deleted');
                        return cb();
                    });
                }

                var ipParams = {
                    network: oldNic.network,
                    network_uuid: oldNic.params.network_uuid,
                    ip: oldNic.params.ip
                };

                common.IP_PARAMS.forEach(function (p) {
                    if (updateParams.hasOwnProperty(p)) {
                        ipParams[p] = updateParams[p];
                    }
                });

                log.debug(ipParams, 'Updating IP %d for nic "%s"',
                    ipParams.ip, params.mac);

                return mod_ip.update(app, log, ipParams, function (err, res) {
                    if (err) {
                        return cb(err);
                    }
                    log.debug(updateParams, 'nic:update: IP updated');

                    return cb();
                });
            },

            function _getNic(_, cb) {
                log.debug(params, 'Getting nic "%s"', params.mac);
                return getNic(app, log, { mac: params.mac },
                    function (err, res) {
                    if (err) {
                        return cb(err);
                    }

                    updatedNic = res;
                    return cb();
                });
            }

        ]}, function (err, res) {
            if (err) {
                return callback(err);
            }

            return callback(null, updatedNic);
        });
}



module.exports = {
    update: update
};
