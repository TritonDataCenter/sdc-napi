/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic tag endpoints
 */

var helpers = require('./helpers');
var NicTag = require('../../lib/models/nic-tag').NicTag;
var test = require('tap').test;
var util = require('util');
var vasync = require('vasync');



// --- Globals



var INVALID_MSG = 'Name must only contain numbers, letters and underscores';
var NAPI;



// --- Setup



test('Create client and server', function (t) {
  helpers.createClientAndServer(function (err, res) {
    t.ifErr(err, 'server creation');
    t.ok(res, 'client');
    NAPI = res;
    t.end();
  });
});



// --- Tests



test('Create nic tag', function (t) {
  var newTag = new NicTag({ name: 'nictag1' });

  helpers.ufdsReturnValues({
    add: [null, newTag],
    get: [null, null]
  });

  NAPI.createNicTag(newTag.params.name, function (err, obj, req, res) {
    t.ifErr(err, 'nic tag create');
    if (err) {
      return t.end();
    }

    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      name: newTag.params.name,
      uuid: newTag.params.uuid
    }, 'Response');

    return t.end();
  });
});


test('Create nic tag with invalid name', function (t) {
  NAPI.createNicTag('has spaces', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.end();
    }

    t.equal(err.statusCode, 422, '422 returned');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [ {
        field: 'name',
        code: 'Invalid',
        message: INVALID_MSG
      } ],
      message: 'Invalid nic tag data: name'
    }, 'Error body');

    return t.end();
  });
});


test('Create nic tag with duplicate name', function (t) {
  helpers.ufdsReturnValues({ get: [null, new NicTag({ name: 'tag1' })] });

  NAPI.createNicTag('tag1', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.end();
    }

    t.equal(err.statusCode, 422, '422 returned');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [ {
        field: 'name',
        code: 'Duplicate',
        message: 'Already exists'
      } ],
      message: 'A nic tag named "tag1" already exists'
    }, 'Error body');

    return t.end();
  });
});



// --- Teardown



test('Stop server', function (t) {
  helpers.stopServer(function (err) {
    t.ifErr(err, 'server stop');
    t.end();
  });
});
