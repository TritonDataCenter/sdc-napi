/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Handles initializing all models
 */

'use strict';

var mod_aggr = require('./aggregation');
var mod_fabric = require('./fabric');
var mod_network_pool = require('./network-pool');
var mod_network = require('./network');
var mod_nic = require('./nic');
var mod_nic_tag = require('./nic-tag');
var mod_vlan = require('./vlan');
var vasync = require('vasync');



// --- Exports



/**
 * Initialize models
 */
function initializeModels(app, callback) {
    vasync.forEachParallel({
        inputs: [
            mod_aggr,
            mod_fabric,
            mod_nic,
            mod_nic_tag,
            mod_network,
            mod_network_pool,
            mod_vlan
        ],
        func: function _initModel(mod, cb) {
            mod.init(app, cb);
        }
    }, callback);
}


module.exports = {
    init: initializeModels,
    models: [
        {
            constructor: mod_network_pool.NetworkPool,
            bucket: mod_network_pool.bucket()
        },
        {
            constructor: mod_network.Network,
            bucket: mod_network.bucket()
        },
        {
            constructor: mod_nic.Nic,
            bucket: mod_nic.bucket()
        },
        {
            constructor: mod_nic_tag.NicTag,
            bucket: mod_nic_tag.bucket()
        },
        {
            constructor: mod_vlan.FabricVLAN,
            bucket: mod_vlan.bucket()
        }
    ]
};
