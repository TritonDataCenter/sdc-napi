/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /networks endpoints with owner_uuid specified
 */

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var nextIP;
var owner = mod_uuid.v4();
var state = {
  testName: 'network-owner'
};
var ufdsAdminUuid = helpers.ufdsAdminUuid;



// --- Helpers


/**
 * Provision a nic on the network with the given owner and check that it
 * succeeded
 */
function checkProvisionSuccess(newOwner, t) {
  var params = {
      belongs_to_type: 'zone',
      belongs_to_uuid: mod_uuid.v4(),
      owner_uuid: newOwner
  };

  napi.provisionNic(state.network.uuid, params, function (err, res) {
    t.ifError(err, 'error returned');
    if (err) {
      t.deepEqual(err.body, {}, 'err body for debugging');
      return t.done();
    }

    params.mac = res.mac;
    params.primary = false;

    if (!nextIP) {
      nextIP = state.network.provision_start_ip;
    } else {
      nextIP = util_ip.ntoa(util_ip.aton(nextIP) + 1);
    }
    params.ip = nextIP;

    helpers.addNetParamsToNic(state, params);
    t.deepEqual(res, params, 'nic params');

    return t.done();
  });
}



// --- Setup



exports['create test nic tag'] = function (t) {
  helpers.createNicTag(t, napi, state);
};



// --- Tests



exports['Create network'] = function (t) {
  helpers.createNetwork(t, napi, state, { owner_uuid: owner });
};


exports['provision: invalid owner'] = function (t) {
  napi.provisionNic(state.network.uuid, {
      belongs_to_type: 'zone',
      belongs_to_uuid: mod_uuid.v4(),
      owner_uuid: mod_uuid.v4()
  }, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, helpers.invalidParamErr({
      errors: [
        mod_err.invalidParam('owner_uuid', constants.OWNER_MATCH_MSG)
      ]
    }), 'Error body');

    return t.done();
  });
};


exports['provision: admin owner_uuid'] = function (t) {
  checkProvisionSuccess(ufdsAdminUuid, t);
};


exports['provision: network owner_uuid'] = function (t) {
  checkProvisionSuccess(owner, t);
};



// --- Teardown



exports['teardown'] = function (t) {
  helpers.deleteNetwork(t, napi, state, function () {
    helpers.deleteNicTags(t, napi, state);
  });
};
