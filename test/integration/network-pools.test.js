/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /network-pools endpoints
 */

var helpers = require('./helpers');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var state = {
  pools: []
};



// --- Setup



exports['create test nic tag'] = function (t) {
  helpers.createNicTag(t, napi, state);
};


exports['create test network'] = function (t) {
  helpers.createNetwork(t, napi, state);
};


exports['create test network 2'] = function (t) {
  helpers.createNetwork(t, napi, state, {}, 'network2');
};


exports['create test network 3'] = function (t) {
  helpers.createNetwork(t, napi, state, {}, 'network3');
};



// --- Tests



exports['POST /network_pools'] = function (t) {
  var params = {
    name: 'network_pool' + process.pid,
    networks: [ state.network.uuid, state.network2.uuid ].sort()
  };

  napi.createNetworkPool(params.name, params, function (err, res) {
    t.ifError(err, 'create test network pool: ' + params.uuid);
    if (err) {
      return t.done();
    }

    t.ok(res.uuid, 'test network pool ' + params.name + ' uuid: ' + res.uuid);
    state.pools.push(res);
    params.uuid = res.uuid;
    t.deepEqual(res, params, 'create params');

    return napi.getNetworkPool(res.uuid, function (err2, res2) {
      t.ifError(err, 'get network pool: ' + params.uuid);
      if (err) {
        return t.done();
      }

      t.deepEqual(res2, params, 'get params for ' + params.uuid);
      return t.done();
    });
  });
};


exports['GET /network_pools'] = function (t) {
  napi.listNetworkPools(function (err, res) {
    t.ifError(err, 'get network pools');
    var found = 0;
    var pool0 = state.pools[0];

    for (var i = 0; i < res.length; i++) {
      var cur = res[i];
      if (cur.uuid == pool0.uuid) {
        t.deepEqual(cur, pool0, 'pool in list: ' + pool0.name);
        found++;
      }
    }

    t.equal(found, 1, 'found pool in list');
    return t.done();
  });
};


exports['PUT /network_pools/:uuid'] = function (t) {
  var params = {
    name: 'network_pool2' + process.pid,
    networks: [ state.network.uuid, state.network3.uuid ].sort()
  };

  napi.updateNetworkPool(state.pools[0].uuid, params, function (err, res) {
    t.ifError(err, 'update test network pool: ' + params.uuid);
    if (err) {
      return t.done();
    }

    params.uuid = state.pools[0].uuid;
    t.deepEqual(res, params, 'update params');

    return napi.getNetworkPool(res.uuid, function (err2, res2) {
      t.ifError(err, 'get network pool: ' + params.uuid);
      if (err) {
        return t.done();
      }

      t.deepEqual(res2, params, 'get params for ' + params.uuid);
      return t.done();
    });
  });
};


exports['DELETE /nic_tags'] = function (t) {
  vasync.forEachParallel({
    inputs: state.pools,
    func: function (pool, cb) {
      napi.deleteNetworkPool(pool.uuid, function (err) {
        t.ifError(err, 'delete test network pool ' + pool.name);
        cb(err);
      });
    }
  }, function (err, res) {
    return t.done();
  });
};



// --- Teardown



exports['remove test network'] = function (t) {
  helpers.deleteNetwork(t, napi, state);
};

exports['remove test network 2'] = function (t) {
  helpers.deleteNetwork(t, napi, state, 'network2');
};

exports['remove test network 3'] = function (t) {
  helpers.deleteNetwork(t, napi, state, 'network3');
};

exports['remove test nic tag'] = function (t) {
  helpers.deleteNicTag(t, napi, state);
};
