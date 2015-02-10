/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * overlay model
 */

var mod_moray = require('../apis/moray');
var restify = require('restify');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_subnet = require('../util/subnet');
var UUID = require('node-uuid');
var validate = require('../util/validate');


// --- Globals

var BUCKET = {
    desc: 'overlay',
    name: 'napi_overlays',
    schema: {
        index: {
            networks: { type: '[string]' },
            owner_uuids: { type: 'string' },
            uuid: { type: 'string', unique: true },
            vlan_id: { type: 'number' },
            v: { type: 'number' }
        }
    },
    migrationVersion: 0,
    version: 0
};


// --- Helpers


// --- Overlay object



/**
 * Overlay model constructor
 */
function Overlay(params) {
    this.params = {
        name: params.name,
        networks: params.networks,
        uuid: params.uuid,
        vlan_id: Number(params.vlan_id),
        v: BUCKET.migrationVersion
    };

    if (!params.uuid) {
        this.params.uuid = UUID.v4();
    }

    this.__defineGetter__('uuid', function () { return this.params.uuid; });
}


/**
 * Returns the raw form suitable for storing in moray
 */
Overlay.prototype.raw = function overlayRaw() {
    return this.params;
};


/**
 * Returns the serialized form of the overlay
 */
Overlay.prototype.serialize = function overlaySerializer() {
    return this.params;
};


// --- Exported functions


/**
 * Creates a new overlay
 */
function createOverlay(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;
    log.debug(params, 'createOverlay: entry');

    validate.params({
        params: params,

        required: {
            name: validate.string,
            vlan_id: validate.VLAN
        },

        optional: {
            owner_uuids: validate.UUIDarray,
            networks: validate.UUIDarray,
            uuid: validate.UUID
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var overlay = new Overlay(validated);
        app.moray.putObject(BUCKET.name, overlay.uuid, overlay.raw(),
                function (err2) {

            if (err2) {
                return callback(err2);
            }
            return callback(null, overlay);
        });
    });
}



/**
 * Deletes an overlay
 */
function deleteOverlay(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'deleteOverlay: entry');

    validate.params({
        params: opts.params,
        required: {
            uuid: validate.UUID
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        mod_moray.delOb(app.moray, BUCKET, validated.uuid, function (err2) {
            if (err2) {
                return callback(err2);
            }
            log.info(validated, 'deleted overlay %s', validated.uuid);
            return callback();
        });
    });
}



/**
 * Gets an overlay
 */
function getOverlay(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'getOverlay: entry');

    validate.params({
        params: opts.params,
        required: {
            uuid: validate.UUID
        }
    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var uuid = validated.uuid;
        mod_moray.getObj(app.moray, BUCKET, uuid, function (err2, res) {
            if (err2) {
                return callback(err2);
            }
            return callback(null, res);
        });
    });
}



/**
 * Initializes the overlays bucket
 */
function initOverlaysBucket(opts, callback) {
    mod_moray.initBucket(opts.app.moray, BUCKET, callback);
}



/**
 * Lists overlays
 */
function listOverlays(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    log.debug(opts.params, 'listOverlays: entry');
    mod_moray.listObjs({
        defaultFilter: '(uuid=*)',
        filter: opts.params,
        log: log,
        bucket: BUCKET,
        model: Overlay,
        moray: app.moray,
        sort: {
            attribute: 'name',
            order: 'ASC'
        }
    }, callback);
}



/**
 * Updates overlays
 */
function updateOverlay(opts, callback) {
    var log = opts.log;
    log.debug(opts.params, 'updateOverlays: entry');

    // TODO finish this
}


module.exports = {
    create: createOverlay,
    del: deleteOverlay,
    get: getOverlay,
    init: initOverlaysBucket,
    list: listOverlays,
    update: updateOverlay
};
