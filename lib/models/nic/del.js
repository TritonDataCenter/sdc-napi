/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

/*
 * nic model: deleting
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var restify = require('restify');
var validate = require('../../util/validate');
var vasync = require('vasync');
var VError = require('verror');


// --- Internal

var DELETE_SCHEMA = {
    required: {
        mac: validate.MAC
    }
};

function validateDeleteParams(opts, callback) {
    validate.params(DELETE_SCHEMA, null, opts.params, function (err, res) {
        opts.validatedParams = res;
        return callback(err);
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
    opts.batch = opts.existingNic.delBatch(opts);

    cb();
}

function delIPs(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.existingNic, 'opts.existingNic');

    if (opts.existingNic.ip === null) {
        opts.log.debug('nic: delete: nic "%s" has no IPs', opts.params.mac);
        callback();
        return;
    }

    [ opts.existingNic.ip ].forEach(function (ip) {
        delIP(opts, ip);
    });

    callback();
}


function delIP(opts, ip) {
    assert.object(opts, 'opts');
    assert.object(ip, 'ip');

    if (ip.params.belongs_to_uuid === opts.existingNic.params.belongs_to_uuid) {
        opts.batch.push(ip.unassignBatch());
    } else {
        opts.log.warn({
            nic_owner: opts.existingNic.params.belongs_to_uuid,
            ip_owner: ip.params.belongs_to_uuid,
            mac: opts.params.mac,
            ip: ip.address
        }, 'nic: delete: IP and NIC belongs_to_uuid do not match');
    }
}


/**
 * Perform a normal batch commit, but check if the NIC has already been removed
 * from underneath us.
 */
function commitBatch(opts, callback) {
    common.commitBatch(opts, function (err) {
        if (err && VError.hasCauseWithName(err, 'ObjectNotFoundError')) {
            callback(new restify.ResourceNotFoundError(err, 'nic not found'));
            return;
        }

        callback(err);
    });
}


/**
 * Public to the 'nic' changefeed that we have deleted a NIC.
 */
function publishDeleteNIC(opts, callback) {
    opts.app.publisher.publish({
        changeKind: {
            resource: 'nic',
            subResources: [ 'delete' ]
        },
        changedResourceId: opts.existingNic.mac.toString(),
        belongs_to_uuid: opts.existingNic.params.belongs_to_uuid,
        cn_uuid: opts.existingNic.params.cn_uuid
    }, callback);
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
            listVnetCns,
            addNicToBatch,
            delIPs,
            commitBatch,
            publishDeleteNIC
        ]
    }, function (err) {
        if (err) {
            opts.log.error(err, 'nic: delete: error');
        }

        callback(err);
    });
}



module.exports = {
    del: del
};
