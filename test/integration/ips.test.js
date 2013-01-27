/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /networks/:uuid/ips endpoints
 */

var helpers = require('./helpers');
var test = require('tap').test;
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var state = {};
var uuids = {
  admin: '00000000-0000-0000-0000-000000000000',
  a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2'
};



// --- Setup



exports['create test nic tag'] = function (t) {
  helpers.createNicTag(t, napi, state);
};


exports['create test network'] = function (t) {
  helpers.createNetwork(t, napi, state);
};



// --- Tests



exports['GET /networks/:uuid/ips/:ip (free IP)'] = function (t) {
  napi.getIP(state.network.uuid, '10.99.99.57', function (err, res) {
    t.ifError(err, 'getting IP: 10.99.99.57');
    var exp = {
      ip: '10.99.99.57',
      reserved: false,
      free: true
    };
    t.deepEqual(res, exp, 'GET on a free IP');

    return t.done();
  });
};


exports['PUT /networks/:uuid/ips/:ip'] = function (t) {
  var params = {
    reserved: true,
    owner_uuid: uuids.admin,
    belongs_to_type: 'zone',
    belongs_to_uuid: uuids.a
  };

  napi.updateIP(state.network.uuid, '10.99.99.59', params, function (err, res) {
    if (err) {
      return helpers.doneWithError(err, 'updating IP: 10.99.99.59');
    }

    params.ip = '10.99.99.59';
    params.free = false;
    state.ip = params;
    t.deepEqual(res, params, 'reserving an IP');

    return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
      if (err2) {
        return t.done();
      }

      t.deepEqual(res2, params, 'GET on a reserved IP');

      return t.done();
    });
  });
};


exports['GET /networks/:uuid/ips'] = function (t) {
  napi.listIPs(state.network.uuid, function (err, res) {
    if (err) {
      return helpers.doneWithError(err, 'listing IPs');
    }

    var broadcastIP = {
      belongs_to_type: 'other',
      belongs_to_uuid: uuids.admin,
      free: false,
      ip: '10.99.99.255',
      owner_uuid: uuids.admin,
      reserved: true
    };

    t.deepEqual(res, [ state.ip, broadcastIP ], 'IP list');
    return t.done();
  });
};


exports['PUT /networks/:uuid/ips/:ip (free an IP)'] = function (t) {
  var doUpdate = function (_, cb) {
    var params = {
      free: true
    };

    napi.updateIP(state.network.uuid, '10.99.99.59', params,
      function (err, res) {
      if (err) {
        return helpers.doneWithError(t, err, 'freeing IP: 10.99.99.59');
      }

      params.ip = '10.99.99.59';
      params.free = true;
      params.reserved = false;
      t.deepEqual(res, params, 'freeing an IP');

      return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
        t.ifError(err2, 'getting free IP: 10.99.99.59');
        if (err2) {
          return cb(err2);
        }

        t.deepEqual(res2, params, 'GET on a free IP');
        return cb();
      });
    });
  };

  // Try this twice, to prove that it works for both a free and a non-free IP
  vasync.pipeline({
    funcs: [
      doUpdate,
      doUpdate
    ]
  }, function (err) {
    return t.done();
  });
};


// XXX: tests to add:
// * exhaust a subnet test:
//   * create a /28
//   * provision all IPs on it - verify we get them in order
//   * verify out of IPs error
//   * unassign 3 IPs, but reserve one of them
//   * provision 3 more times: should only get the 2 unreserved IPs, plus
//     an out of IPs error
// * same as above, but provision with an IP in the middle of the range
//   first



// --- Teardown



exports['remove test network'] = function (t) {
  helpers.deleteNetwork(t, napi, state);
};


exports['remove test nic tag'] = function (t) {
  helpers.deleteNicTag(t, napi, state);
};
