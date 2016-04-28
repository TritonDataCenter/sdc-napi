/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * fabric model
 */

'use strict';

var constants = require('../util/constants');
var mod_moray = require('../apis/moray');
var validate = require('../util/validate');



// --- Globals



var BUCKET = {
    desc: 'fabric',
    name: 'napi_fabrics',
    schema: {
        index: {
            vnet_id: { type: 'number', unique: true }
        }
    }
};



// --- Helpers



/**
 * Generate a random 24-bit virtual network (VxLAN) ID in the correct range
 */
function randomVnetID() {
    return Math.floor(Math.random() * constants.MAX_VNET_ID);
}



// --- Fabric object



/**
 * Fabric model constructor
 */
function Fabric(params) {
    this.params = {
        owner_uuid: params.owner_uuid,
        vnet_id: params.vnet_id || randomVnetID()
    };
}

Object.defineProperty(Fabric.prototype, 'id', {
    get: function () { return this.params.owner_uuid; }
});

Object.defineProperty(Fabric.prototype, 'vnet_id', {
    get: function () { return this.params.vnet_id; }
});


/**
 * Returns the raw form of the fabric suitable for adding to a moray batch
 */
Fabric.prototype.batch = function fabricBatch() {
    return {
        bucket: BUCKET.name,
        key: this.id,
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag || null
        }
    };
};


/**
 * Returns the raw form of the fabric suitable for storing in moray
 */
Fabric.prototype.raw = function fabricRaw() {
    return {
        owner_uuid: this.params.owner_uuid,
        vnet_id: this.params.vnet_id
    };
};



// --- Exported functions



/**
 * Gets a fabric
 */
function getFabric(opts, callback) {
    opts.log.debug({ params: opts.params }, 'getFabric: entry');

    validate.params({
        params: opts.params,
        required: {
            owner_uuid: validate.UUID
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(opts.app.moray, BUCKET, opts.params.owner_uuid,
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new Fabric(rec.value));
        });
    });
}


/**
 * Initializes the nic tags bucket
 */
function initFabricsBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}



module.exports = {
    Fabric: Fabric,
    get: getFabric,
    init: initFabricsBucket
};
