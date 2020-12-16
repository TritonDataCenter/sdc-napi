/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * To allow an operator to limit the number of VPCs per user, we keep a running
 * total of VPCs used per user in a moray bucket. When a VPC is created or
 * deleted, we get the current VPC count for the user (and deny if any quota
 * is exceeded). When a VPC is created or deleted, we include a VPCQuota object
 * in the moray batch with the updated count. It is batched so that the
 * updates will happen atomically (and concurrent update/deletes by the
 * same user will fail/require retry) to prevent lost updates.
 */
'use strict';

var mod_moray = require('../apis/moray');
var validate = require('../util/validate');
var vasync = require('vasync');

var BUCKET = {
    desc: 'VPC Usage Quotas',
    name: 'vpc_quota'
};

var GET_SCHEMA = {
    required: {
        owner_uuid: validate.UUID
    }
};

function VPCQuota(params) {
    this.params = {
        owner_uuid: params.owner_uuid,
        vpc_count: params.vpc_count || 0
    };
}

Object.defineProperty(VPCQuota.prototype, 'id', {
    get: function () {
        return this.params.owner_uuid;
    }
});

/*
 * Returns an object that includes the raw form of the object for use
 * in a moray batch.
 */
VPCQuota.prototype.batch = function vpcQuotaBatch() {
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

VPCQuota.prototype.raw = function vpcQuotaRaw() {
    var raw = {
        owner_uuid: this.params.owner_uuid,
        vpc_count: this.params.vpc_count
    };

    return raw;
};

function getVPCQuota(opts, callback) {
    opts.log.debug({ params: opts.params }, 'getVPCQuota: entry');

    vasync.waterfall([
        function validateParams(cb) {
            validate.params(GET_SCHEMA, null, opts.params,
            function onValidate(err, validated) {
                if (err) {
                    cb(err);
                    return;
                }
                cb(null, validated);
            });
        },

        function getFromMoray(validated, cb) {
            mod_moray.getObj(opts.app.moray, BUCKET, validated.owner_uuid,
            function onGet(err, rec) {
                if (err) {
                    if (err.statusCode === 404) {
                        // If no entry exists, create a new quota object for
                        // the user.
                        cb(null, new VPCQuota({
                            owner_uuid: validated.owner_uuid
                        }));
                        return;
                    }
                    cb(err);
                    return;
                }

                cb(null, rec);
            });
        }
    ], function onGetdone(rec) {
        callback(null, new VPCQuota(rec.value));
        return;
    });
}

function initVPCQuotaBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}

module.exports = {
    VPCQuota: VPCQuota,
    get: getVPCQuota,
    init: initVPCQuotaBucket
};
