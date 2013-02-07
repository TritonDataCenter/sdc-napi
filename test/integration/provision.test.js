/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for provisioning IPs
 */

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var napi = helpers.createNAPIclient();
var netParams = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers'];
var state = {
  macs: []
};
var uuids = {
  admin: '00000000-0000-0000-0000-000000000000',
  a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2',
  b: '91abd897-566a-4ae5-80d2-1ba103221bbc',
  c: 'e8e2deb9-2d68-4e4e-9aa6-4962c879d9b1',
  d: UUID.v4()
};



// --- Helper functions



function addNetworkParams(params) {
  for (var n in netParams) {
    params[netParams[n]] = state.network[netParams[n]];
  }
  params.network_uuid = state.network.uuid;
}



// --- Setup



exports.setup = function (t) {
  vasync.pipeline({
  funcs: [
    function _nicTag(_, cb) {
      helpers.createNicTag(t, napi, state, cb);
    },

    function _net(_, cb) {
      var params = {
        name: 'network-integration-small' + process.pid,
        provision_end_ip: '10.0.1.10',
        provision_start_ip: '10.0.1.1',
        subnet: '10.0.1.0/28',
        nic_tag: state.nicTag.name
      };

      helpers.createNetwork(t, napi, state, params, cb);
    }

  ] }, function (err, res) {
    t.ifError(err);
    if (err) {
      t.deepEqual(err.body, {}, 'error body');
    }

    return t.done();
  });
};



// --- Tests



// Hammer NAPI with a bunch of concurrent IP provisions, and make sure that
// we get a unique IP for each
exports['fill network'] = function (t) {
  var exp = [];
  var ips = [];
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    network_uuid: state.network.uuid
  };

  var barrier = vasync.barrier();

  function doCreate(num) {
    barrier.start('create-' + num);
    var mac = helpers.randomMAC();
    napi.createNic(mac, params, function (err, res) {
      barrier.done('create-' + num);
      t.ifError(err, 'provision nic ' + num);
      if (err) {
        t.deepEqual(err.body, {}, 'error body: ' + num);
        return;
      }

      t.equal(res.network_uuid, params.network_uuid, 'network uuid: ' + num);
      ips.push(res.ip);
      state.macs.push(res.mac);
    });
  }

  for (var i = 0; i < 10; i++) {
    exp.push('10.0.1.' + (i + 1));
    doCreate(i);
  }

  barrier.on('drain', function () {
    t.equal(ips.length, 10, '10 IPs provisioned');
    var sorted = ips.sort(function (a, b) {
      return (util_ip.aton(a) > util_ip.aton(b)) ? 1 : -1;
    });
    t.deepEqual(sorted, exp, 'All IPs provisioned');

    // Subnet should now be full
    napi.createNic(helpers.randomMAC(), params, function (err, res) {
      t.ok(err, 'error returned');
      if (!err) {
        return t.done();
      }

      t.equal(err.statusCode, 507, 'status code');
      t.deepEqual(err.body, {
        code: 'SubnetFull',
        message: constants.SUBNET_FULL_MSG
      }, 'error');

      return t.done();
    });
  });
};



// --- Teardown



exports['teardown'] = function (t) {
  vasync.forEachParallel({
    inputs: state.macs,
    func: function _delNic(mac, cb) {
      napi.deleteNic(mac, function (err) {
        t.ifError(err);
        if (err) {
          t.deepEqual(err.body, {}, 'error body');
        }

        return cb(err);
      });
    }
  }, function () {
    helpers.deleteNetwork(t, napi, state, function () {
      helpers.deleteNicTags(t, napi, state);
    });
  });
};


// Use to run only one test in this file:
if (runOne) {
  module.exports = {
    setup: exports.setup,
    oneTest: runOne,
    teardown: exports.teardown
  };
}
