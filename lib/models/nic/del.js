/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model: deleting
 */

'use strict';

var common = require('./common');
var getNic = require('./get').get;
var mod_ip = require('../ip');
var validate = require('../../util/validate');
var vasync = require('vasync');


// --- Internal


function validateDeleteParams(opts, callback) {
    validate.params({
        params: opts.params,

        required: {
            mac: common.validateMAC
        }
    }, function (err, res) {
        opts.validatedParams = res;
        return callback(err);
    });
}

function getExistingNic(opts, cb) {
    getNic(opts, function (err, nic) {
        opts.existingNic = nic;
        return cb(err);
    });
}

function listVnetCns(opts, cb) {
    if (!opts.existingNic.isFabric()) {
        return cb();
    }
    var listOpts = {
        vnet_id: opts.existingNic.network.vnet_id,
        moray: opts.app.moray,
        log: opts.log
    };
    common.listVnetCns(listOpts, function (listErr, vnetCns) {
        if (listErr) {
            return cb(listErr);
        }
        opts.vnetCns = vnetCns;
        return cb();
    });
}

function addNicToBatch(opts, cb) {
    opts.batch = opts.existingNic.delBatch({ log: opts.log,
        vnetCns: opts.vnetCns });
    return cb();
}

function delIP(opts, cb) {
    // XXX: Add the rest of this to the batch above as well!

    if (!opts.existingNic || !opts.existingNic.ip) {
        opts.log.debug('nic: delete: nic "%s" has no IP', opts.params.mac);
        return cb();
    }

    if (opts.existingNic.ip.params.belongs_to_uuid !==
        opts.existingNic.params.belongs_to_uuid) {
        opts.log.debug({ mac: opts.params.mac,
            ip: opts.existingNic.ip.address },
            'nic: delete: IP and nic belongs_to_uuid do not match');
        return cb();
    }

    // XXX: may want some way to override this and force the delete
    if (opts.existingNic.ip.params.reserved) {
        opts.log.debug('nic: delete: nic "%s" has a reserved IP',
            opts.params.mac);
        return mod_ip.update(opts.app, opts.log, {
            ip: opts.existingNic.ip.address,
            network: opts.existingNic.network,
            network_uuid: opts.existingNic.network.params.uuid,
            belongs_to_uuid:
            opts.existingNic.ip.params.belongs_to_uuid,
            belongs_to_type:
            opts.existingNic.ip.params.belongs_to_type,
            unassign: true
        }, cb);

    } else {
        opts.log.debug('nic: delete: nic "%s": deleting IP', opts.params.mac);
        return mod_ip.del(opts.app, opts.log, {
            network: opts.existingNic.network,
            network_uuid: opts.existingNic.network.uuid,
            ip: opts.existingNic.ip.address
        }, cb);
    }
}


// --- Exports



/**
 * Deletes a nic with the given parameters
 */
function del(opts, callback) {
    opts.log.debug({ params: opts.params }, 'nic: del: entry');

    vasync.pipeline({
        arg: opts,
        funcs: [
        validateDeleteParams,
        getExistingNic,
        listVnetCns,
        addNicToBatch,
        common.commitBatch,
        delIP
    ]}, function (err) {
        if (err) {
            opts.log.error(err, 'nic: delete: error');
        }
        return callback(err);
    });
}



module.exports = {
    del: del
};
