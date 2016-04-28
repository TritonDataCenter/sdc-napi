/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model: updating
 */

'use strict';

var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var getNic = require('./get').get;
var mod_ip = require('../ip');
var mod_nicTag = require('../nic-tag');
var mod_portolan_moray = require('portolan-moray');
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
    'vlan_id'
];



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
        return callback(nicErr);
    }

    opts.nic.ip = opts.ip;
    opts.nic.network = opts.validated.network;

    return callback();
}


/**
 * Used the updated parameters in opts.validated to create a new opts.nic
 * and opts.ip, and adds them to opts.batch
 */
function addNicAndIPtoBatch(opts, ipObj, network) {
    var newIP;

    try {
        opts.nic = new Nic(getUpdatedNicParams(opts));
    } catch (nicErr) {
        // XXX: wrap this error with WError
        throw nicErr;
    }

    if (ipObj) {
        // Use the new nic's params to populate the new IP: this ensures
        // it gets any updated parameters
        newIP = mod_ip.createUpdated(ipObj, opts.nic.params);
        opts.nic.ip = newIP;
        opts.nic.network = network;
    }

    provision.addNicToBatch(opts);

    if (newIP) {
        opts.batch.push(newIP.batch());
    }
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

    return updatedNicParams;
}



// --- Internal functions in the update chain

/**
 * Get the existing nic from moray
 */
function getExistingNic(opts, callback) {
    opts.log.trace('getExistingNic: entry');

    getNic(opts, function (err, res) {
        opts.existingNic = res;
        return callback(err);
    });
}

/**
 * Validate a nic tag that may potentially be an overlay tag (of the form
 * sdc_overlay_tag/1234)
 */
function validateNicTag(opts, name, tag, callback) {
    validate.string(name, tag, function (strErr) {
        if (strErr) {
            return callback(strErr);
        }

        var split = tag.split('/');
        var tagName = split[0];

        mod_nicTag.validateExists(opts.app, opts.log, true, name, tagName,
                function (exErr) {
            if (exErr) {
                return callback(exErr);
            }

            if (!split[1]) {
                return callback(null, tagName);
            }

            validate.VxLAN(name, split[1], function (vErr, vid) {
                if (vErr) {
                    return callback(vErr);
                }

                var toReturn = {};
                toReturn[name] = tagName;
                toReturn.vnet_id = vid;

                return callback(null, null, toReturn);
            });
        });
    });
}

/**
 * Validate update params
 */
function validateUpdateParams(opts, callback) {
    opts.log.trace('validateUpdateParams: entry');

    validate.params({
        params: opts.params,

        required: {
            mac: common.validateMAC
        },

        optional: {
            // XXX: allow passing an optional arg to validate.params(), so
            // that we can pass opts to these fns as an arg. This would allow
            // us to move this object up to top-level (replacing UPDATE_PARAMS),
            // so that we don't have to duplicate these
            allow_dhcp_spoofing: validate.bool,
            allow_ip_spoofing: validate.bool,
            allow_mac_spoofing: validate.bool,
            allow_restricted_traffic: validate.bool,
            allow_unfiltered_promisc: validate.bool,
            belongs_to_type: validate.string,
            belongs_to_uuid: validate.UUID,
            check_owner: validate.bool,
            cn_uuid: validate.UUID,
            ip: validate.IP,
            owner_uuid: validate.UUID,
            model: validate.string,
            network_uuid: common.validateNetwork.bind(null, opts.app,
                opts.log),
            nic_tag: validateNicTag.bind(null, opts),
            nic_tags_provided:
                mod_nicTag.validateExists.bind(null, opts.app, opts.log,
                    false),
            primary: validate.bool,
            reserved: validate.bool,
            state: validate.nicState,
            // XXX: only allow this if belongs_to_type is 'server'
            underlay: validate.bool,
            vlan_id: validate.VLAN
        },

        after: function (original, parsed, cb2) {
            // Only add the old IP's network if we're not
            // updating to a new network
            if (!parsed.hasOwnProperty('network') && opts.existingNic &&
                opts.existingNic.hasOwnProperty('network')) {
                parsed.network = opts.existingNic.network;
                parsed.network_uuid = opts.existingNic.network.uuid;
            }

            common.validateNetworkParams({ app: opts.app, log: opts.log },
                original, parsed, cb2);
        }
    }, function (err, res) {
        opts.validated = res;

        if (opts.log.debug()) {
            opts.log.debug({ validated: res }, 'validated params');
        }

        return callback(err);
    });
}


/**
 * Determine what sort of update type this is and set opts.updateType
 * accordingly, so that later functions in the update chain can run.
 */
function setUpdateType(opts, callback) {
    opts.log.trace('setUpdateType: entry');

    var oldNic = opts.existingNic;
    var oldIP = oldNic.params.ip;

    opts.updateType = 'update';

    if (!oldIP && opts.validated.network_uuid) {
        // The nic didn't have an IP before, but we want one: let
        // provisionIP() handle
        opts.updateType = 'provision';
        opts.log.debug({ updateType: opts.updateType }, 'update type');
        return callback();
    }

    opts.log.debug({ updateType: opts.updateType }, 'update type');
    return callback();
}


/**
 * If opts.updateType is 'provision', try to provision an IP with the
 * updated nic params
 */
function provisionIP(opts, callback) {
    opts.log.trace('provisionIP: entry');

    if (opts.updateType !== 'provision') {
        return callback();
    }

    opts.nicFn = addUpdatedNic;
    opts.ipParams = mod_ip.params(getUpdatedNicParams(opts));

    var existingIP = opts.validated._ip;
    if (existingIP && existingIP.provisionable()) {
        // We're provisioning an existing IP, and it's OK to be provisioned:
        // add _ip so that provision.ipOnNetwork() will use it
        opts.ipParams._ip = existingIP;
    }

    return provision.nicAndIP(opts, callback);
}


/**
 * If opts.update is 'update', update both the nic and IP. If changing IPs,
 * free the old one (but only if its ownership hasn't changed out from
 * under us).
 */
function updateParams(opts, callback) {
    opts.log.trace('updateParams: entry');

    if (opts.updateType !== 'update') {
        return callback();
    }

    var newIP = opts.validated._ip;
    var oldNic = opts.existingNic;
    var oldIP = oldNic.ip;
    var changingIP = false;

    var paramIP = opts.existingNic.ip;
    var paramNet = opts.existingNic.network;

    if (oldIP && newIP &&
        oldIP.address.toString() !== newIP.address.toString()) {
        // We are changing the nic from one IP address to another
        changingIP = true;
        paramIP = newIP;
        paramNet = opts.validated.network;

        if (oldIP.params.hasOwnProperty('belongs_to_uuid') &&
            newIP.params.hasOwnProperty('belongs_to_uuid') &&
            oldIP.params.belongs_to_uuid !== newIP.params.belongs_to_uuid) {
            var oldUsedErr = new errors.InvalidParamsError(
                constants.msg.INVALID_PARAMS, [ errors.usedByParam('ip',
                    newIP.params.belongs_to_type, newIP.params.belongs_to_uuid,
                    util.format(constants.fmt.IP_IN_USE,
                        newIP.params.belongs_to_type,
                        newIP.params.belongs_to_uuid))
                ]);
            oldUsedErr.stop = true;
            return callback(oldUsedErr);
        }
    }

    // due to poor factoring of create/update operations, udpates of
    // type 'update' get the appropriate SVP logs created after the updated
    // nic object is created below. See also Nic.batch.
    opts.vnetCns = [];
    try {
        addNicAndIPtoBatch(opts, paramIP, paramNet);
    } catch (batchErr) {
        return callback(batchErr);
    }

    if (changingIP && oldIP.params.belongs_to_uuid ===
        oldNic.params.belongs_to_uuid) {
        opts.batch.push(oldIP.batch({ free: true }));
    }

    // SVP logs must be updated when the MAC:IP mappings change, since the MAC
    // is not updatable, we are only concerned with IP changes. We may need
    // to create logs for one, none, or both of the following situations:
    //   - the existing nic is on a fabric network (requires VL2 logs)
    //   - the updated nic is on a fabric network (requires VL3 logs)
    vasync.parallel({
        funcs: [
            function _existingVnetCns(cb) {
                if (!changingIP || !opts.existingNic.isFabric()) {
                    return cb();
                }
                common.listVnetCns({
                    vnet_id: opts.existingNic.vnet_id,
                    moray: opts.moray,
                    log: opts.log
                }, function (listErr, cns) {
                    if (listErr) {
                        return cb(listErr);
                    }
                    opts.batch.concat(mod_portolan_moray.vl2CnEventBatch({
                        log: opts.log,
                        vnetCns: cns,
                        vnet_id: opts.existingNic.vnet_id,
                        mac: opts.existingNic.mac
                    }));
                    return cb();
                });
            },
            function _updatedVnetCns(cb) {
                if (!changingIP || !opts.nic.isFabric()) {
                    return cb();
                }
                common.listVnetCns({
                    vnet_id: opts.nic.vnet_id,
                    moray: opts.moray,
                    log: opts.log
                }, function (listErr, cns) {
                    if (listErr) {
                        return cb(listErr);
                    }
                    opts.batch.concat(mod_portolan_moray.vl3CnEventBatch({
                        log: opts.log,
                        vnetCns: cns,
                        vnet_id: opts.nic.vnet_id,
                        ip: opts.nic.ip,
                        mac: opts.nic.mac,
                        vlan_id: opts.nic.vlan_id
                    }));
                    return cb();
                });
            }
        ]
    }, function (listErr, results) {
        if (listErr) {
            return callback(listErr);
        }
        return common.commitBatch(opts, callback);
    });
}


// --- Exports


/**
 * Updates a nic with the given parameters
 */
function update(opts, callback) {
    opts.log.trace('nic.update: entry');

    var funcs = [
        getExistingNic,
        validateUpdateParams,
        setUpdateType,
        provisionIP,
        updateParams
    ];

    opts.batch = [];

    vasync.pipeline({
        arg: opts,
        funcs: funcs
    }, function (err) {
        if (err) {
            opts.log.error({
                before: opts.existingNic ?
                    opts.existingNic.serialize() : '<does not exist>',
                err: err,
                params: opts.validated
            }, 'Error updating nic');

            return callback(err);
        }

        opts.log.info({
            before: opts.existingNic.serialize(),
            params: opts.validated,
            after: opts.nic.serialize()
        }, 'Updated nic');

        return callback(null, opts.nic);
    });
}



module.exports = {
    update: update
};
