/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var helpers = require('./helpers');
var IP = require('../../lib/models/ip').IP;
var mod_uuid = require('node-uuid');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var NAPI;
var NET;



// --- Internal helpers



// --- Setup



/**
 * Sets up UFDS to return a nic tag so that the existance check in
 * network creation passes
 */
exports.setUp = function (callback) {
  NET = new Network(helpers.validNetworkParams());
  helpers.ufdsReturnValues({
    get: [
      [null, NET]
    ]
  });

  return callback();
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



exports['Create nic - mising params'] = function (t) {
  NAPI.post('/nics', {}, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      message: 'Missing parameters',
      errors: [
        helpers.missingParam('belongs_to_type', 'Missing parameter'),
        helpers.missingParam('belongs_to_uuid', 'Missing parameter'),
        helpers.missingParam('owner_uuid', 'Missing parameter')
      ]
    }, 'Error body');

    return t.done();
  });
};


exports['Create nic - mising params'] = function (t) {
  // Set UFDS to return nothing
  helpers.ufdsReturnValues({
    get: [
      [null, null],
      [null, null],
      [null, null]
    ]
  });

  var params = {
    belongs_to_type: '',
    belongs_to_uuid: 'asdf',
    ip: 'foo',
    model: '',
    owner_uuid: 'invalid',
    network_uuid: 'asdf',
    nic_tags_provided: ['does', 'not', 'exist'],
    reserved: 'invalid'
  };

  NAPI.createNic('foobar', params, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      message: 'Invalid parameters',
      errors: [
        helpers.invalidParam('belongs_to_type', 'must not be empty'),
        helpers.invalidParam('belongs_to_uuid', 'invalid UUID'),
        helpers.invalidParam('ip', 'invalid IP address'),
        helpers.invalidParam('model', 'must not be empty'),
        helpers.invalidParam('network_uuid', 'invalid UUID'),
        {
          code: 'InvalidParameter',
          field: 'nic_tags_provided',
          invalid: params.nic_tags_provided,
          message: 'nic tags do not exist'
        },
        helpers.invalidParam('owner_uuid', 'invalid UUID'),
        helpers.invalidParam('reserved', 'must be a boolean value')
      ]
    }, 'Error body');

    return t.done();
  });
};


// XXX: create nic with IP, then create another nic with the same IP.  Old nic
// should no longer have that IP
// XXX: test provisioning a nic with an IP outside the LN
//      ... and updating
// non-existent network for network_uuid
// non-existant nic tag
// XXX: both belongs_to_type and _uuid required
// XXX: test creating a nic with network_uuid=admin



// --- Teardown



exports['Stop server'] = function (t) {
  helpers.stopServer(function (err) {
    t.ifError(err, 'server stop');
    t.done();
  });
};
