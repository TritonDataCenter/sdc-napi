/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for network endpoints
 */

var assert = require('assert-plus');
var helpers = require('./helpers');
var IP = require('../../lib/models/ip').IP;
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var VLAN_MSG = 'VLAN ID must be a number between 0 and 4094, and not 1';



// --- Setup



/**
 * Sets up UFDS to return a nic tag so that the existance check in
 * network creation passes
 */
exports.setUp = function (callback) {
  helpers.ufdsReturnValues({
    get: [[null, new NicTag({ name: 'nictag1' }) ]]
  });
  callback();
};


exports['Create client and server'] = function (t) {
  helpers.createClientAndServer(function (err, res) {
    t.ifError(err, 'server creation');
    t.ok(res, 'client');
    NAPI = res;
    t.done();
  });
};



// --- Create tests



exports['Create network'] = function (t) {
  var params = helpers.validNetworkParams({
    gateway: '10.0.2.1',
    resolvers: ['8.8.8.8', '10.0.2.2']
  });
  var newNet = new Network(params);
  var ip1 = new IP({ ip: '10.0.2.1', network_uuid: newNet.uuid });
  var ip2 = new IP({ ip: '10.0.2.2', network_uuid: newNet.uuid });
  var tag = new NicTag({ name: params.nic_tag });

  helpers.ufdsReturnValues({
    add: [
      [null, newNet],
      [null, ip1],
      [null, ip2]
    ],
    get: [
      [null, tag]
    ]
  });

  NAPI.createNetwork(params, function (err, obj, req, res) {
    t.ifError(err, 'network create');
    if (err) {
      t.deepEqual(err.body, {}, 'error body');
      return t.done();
    }

    t.equal(res.statusCode, 200, 'status code');

    params.uuid = obj.uuid;
    params.netmask = '255.255.255.0';
    params.vlan_id = 0;

    t.deepEqual(obj, params, 'Response');
    t.deepEqual(helpers.ufdsReturnValues(),
      { add: [], get: [] }, 'all UFDS values returned');

    return t.done();
  });
};


exports['Create network - missing parameters'] = function (t) {
  NAPI.createNetwork({}, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: ['name', 'nic_tag', 'provision_end_ip', 'provision_start_ip',
        'subnet', 'vlan_id'].map(function (name) {
          return {
            code: 'MissingParameter',
            field: name,
            message: 'Missing parameter'
          };
        }),
      message: 'Missing parameters'
    }, 'Error body');

    return t.done();
  });
};


exports['Create network - missing and invalid parameters'] = function (t) {
  NAPI.createNetwork({ provision_start_ip: 'asdf' }, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: ['name', 'nic_tag', 'provision_end_ip',
        'subnet', 'vlan_id'].map(function (name) {
          return {
            code: 'MissingParameter',
            field: name,
            message: 'Missing parameter'
          };
        }).concat([ {
          code: 'InvalidParameter',
          field: 'provision_start_ip',
          message: 'invalid IP address'
        } ]).sort(helpers.fieldSort),
      message: 'Invalid parameters'
    }, 'Error body');

    return t.done();
  });
};


exports['Create network - all invalid parameters'] = function (t) {
  var params = {
    gateway: 'asdf',
    name: '',
    nic_tag: 'nictag0',
    provision_end_ip: '10.0.1.256',
    provision_start_ip: '10.256.1.255',
    resolvers: ['10.5.0.256', 'asdf', '2'],
    subnet: 'asdf',
    vlan_id: 'a'
  };

  NAPI.createNetwork(params, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [
        helpers.invalidParam('gateway', 'invalid IP address'),
        helpers.invalidParam('name', 'must not be empty'),
        helpers.invalidParam('provision_end_ip', 'invalid IP address'),
        helpers.invalidParam('provision_start_ip', 'invalid IP address'),
        {
          code: 'InvalidParameter',
          field: 'resolvers',
          invalid: params.resolvers,
          message: 'invalid IPs'
        },
        helpers.invalidParam('subnet', 'Subnet must be in CIDR form'),
        helpers.invalidParam('vlan_id', VLAN_MSG)
      ],
      message: 'Invalid parameters'
    }, 'Error body');

    return t.done();
  });
};



exports['Create network - invalid parameters'] = function (t) {
  var invalid = [
    ['subnet', '1.2.3.4/a', 'Subnet bits invalid'],
    ['subnet', '1.2.3.4/7', 'Subnet bits invalid'],
    ['subnet', '1.2.3.4/33', 'Subnet bits invalid'],
    ['subnet', 'c/32', 'Subnet IP invalid'],
    ['subnet', 'a/d', 'Subnet IP and bits invalid'],

    ['vlan_id', 'a', VLAN_MSG],
    ['vlan_id', '-1', VLAN_MSG],
    ['vlan_id', '1', VLAN_MSG],
    ['vlan_id', '4095', VLAN_MSG],

    ['provision_start_ip', '10.0.1.254',
      'provision_start_ip cannot be outside subnet'],
    ['provision_start_ip', '10.0.3.1',
      'provision_start_ip cannot be outside subnet'],
    ['provision_start_ip', '10.0.2.255',
      'provision_start_ip cannot be the broadcast address'],

    ['provision_end_ip', '10.0.1.254',
      'provision_end_ip cannot be outside subnet'],
    ['provision_end_ip', '10.0.3.1',
      'provision_end_ip cannot be outside subnet'],
    ['provision_end_ip', '10.0.2.255',
      'provision_end_ip cannot be the broadcast address']
  ];

  var ufdsReturn = { get: [] };
  for (var i = 0; i < invalid.length; i++) {
    ufdsReturn.get.push([null, new NicTag({ name: 'nictag1' }) ]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: invalid,
    func: function (data, cb) {
      var toCreate = helpers.validNetworkParams();
      toCreate[data[0]] = data[1];

      NAPI.createNetwork(toCreate, function (err, res) {
        t.ok(err, util.format('error returned: %s: %s', data[0], data[1]));
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
          code: 'InvalidParameters',
          errors: [
            helpers.invalidParam(data[0], data[2])
          ],
          message: 'Invalid parameters'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Create network - non-existent nic tag'] = function (t) {
  // Set UFDS to return nothing
  helpers.ufdsReturnValues({
    get: [[null, null]]
  });

  NAPI.createNetwork(helpers.validNetworkParams({ nic_tag: 'does_not_exist'}),
    function (err, res) {
    t.ok(err, 'error returned');

    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [
        helpers.invalidParam('nic_tag', 'nic tag does not exist')
      ],
      message: 'Invalid parameters'
    }, 'Error body');

    return t.done();
  });
};


exports['Create network - provision start IP after end IP'] = function (t) {
  NAPI.createNetwork(helpers.validNetworkParams({
    provision_start_ip: '10.0.2.250',
    provision_end_ip: '10.0.2.25'
  }), function (err, res) {
    t.ok(err, 'error returned');

    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [
        helpers.invalidParam('provision_end_ip',
          'provision_start_ip must be before provision_end_ip'),
        helpers.invalidParam('provision_start_ip',
          'provision_start_ip must be before provision_end_ip')
      ],
      message: 'Invalid parameters'
    }, 'Error body');

    return t.done();
  });
};


// XXX: can't delete if in use by a network pool


// --- Teardown



exports['Stop server'] = function (t) {
  helpers.stopServer(function (err) {
    t.ifError(err, 'server stop');
    t.done();
  });
};



// Use to run only one test in this file:
if (runOne) {
  module.exports = {
    setup: exports['Create client and server'],
    setUp: exports.setUp,
    oneTest: runOne,
    teardown: exports['Stop server']
  };
}
