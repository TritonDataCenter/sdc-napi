/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Handles initializing all models
 */

var mod_network_pool = require('./network-pool');
var mod_network = require('./network');
var mod_nic = require('./nic');
var mod_nic_tag = require('./nic-tag');
var vasync = require('vasync');



// --- Exports



/**
 * Initialize models
 */
function initializeModels(app, callback) {
  vasync.forEachParallel({
    inputs: [
      mod_nic,
      mod_nic_tag,
      mod_network,
      mod_network_pool
    ],
    func: function _initModel(mod, cb) {
      mod.init(app, cb);
    }
  }, callback);
}


module.exports = {
  init: initializeModels
};
