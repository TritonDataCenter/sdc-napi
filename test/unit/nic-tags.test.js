/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic tag endpoints
 */

var helpers = require('./helpers');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var util = require('util');
var vasync = require('vasync');



// --- Globals



var INVALID_MSG = 'Name must only contain numbers, letters and underscores';
var NAPI;



// --- Setup



exports['Create client and server'] = function (t) {
  helpers.createClientAndServer(function (err, res) {
    t.ifError(err, 'server creation');
    t.ok(res, 'client');
    NAPI = res;
    t.done();
  });
};



// --- Create tests



exports['Create nic tag'] = function (t) {
  helpers.ufdsReturnValues({
    add: [[null]],
    get: [[null, null]]
  });

  NAPI.createNicTag('newtagname', function (err, obj, req, res) {
    t.ifError(err, 'nic tag create');
    if (err) {
      return t.done();
    }

    var ufdsVals = helpers.ufdsCallValues();
    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      name: 'newtagname',
      uuid: ufdsVals.add[0].raw().uuid
    }, 'Response');

    return t.done();
  });
};


exports['Create nic tag - invalid name'] = function (t) {
  NAPI.createNicTag('has spaces', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, '422 returned');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [ {
        field: 'name',
        code: 'InvalidParameter',
        message: INVALID_MSG
      } ],
      message: 'Invalid parameter: name'
    }, 'Error body');

    return t.done();
  });
};


exports['Create nic tag - missing name'] = function (t) {
  // Use .post directly since the client checks to make sure name is
  // specified
  NAPI.post('/nic_tags', {}, function (err, obj, req, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [ {
        code: 'MissingParameter',
        field: 'name',
        message: 'Missing parameter'
      } ],
      message: 'Missing parameter: name'
    }, 'Error body');

    return t.done();
  });
};


exports['Create nic tag - duplicate name'] = function (t) {
  helpers.ufdsReturnValues({ get: [[null, new NicTag({ name: 'tag1' })]] });

  NAPI.createNicTag('tag1', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
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

    return t.done();
  });
};



// --- Delete tests



exports['Delete nic tag in use'] = function (t) {
  var net = new Network({
    name: 'foo',
    nic_tag: 'foobar',
    provision_start_ip: '10.0.2.1',
    provision_end_ip: '10.0.2.10',
    subnet: '10.0.2.0/24',
    vlan_id: 200
  });

  helpers.ufdsReturnValues({
    list: [[null, [net]]]
  });

  NAPI.deleteNicTag('foobar', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InUse',
      errors: [ {
        code: 'UsedBy',
        id: net.uuid,
        message: util.format('In use by network "%s"', net.uuid),
        type: 'network'
      } ],
      message: 'Nic tag is in use'
    }, 'Error body');

    return t.done();
  });
};



// --- Update tests



exports['Update nic tag - successful'] = function (t) {
  var tag = new NicTag({ name: 'bar2' });
  helpers.ufdsReturnValues({
    get: [[null, null]],
    list: [[null, null]],
    update: [[null, tag]]
  });

  NAPI.updateNicTag('foobar', { name: tag.params.name },
    function (err, obj, req, res) {
    t.ifError(err, 'error returned');
    if (err) {
      return t.done();
    }

    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      name: tag.params.name,
      uuid: tag.params.uuid
    }, 'Response');

    return t.done();
  });
};


exports['Update nic tag - missing name'] = function (t) {
  helpers.ufdsReturnValues({
    list: [[null, null]]
  });

  NAPI.updateNicTag('foobar', { },
    function (err, obj, req, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      errors: [ {
        code: 'MissingParameter',
        field: 'name',
        message: 'Missing parameter'
      } ],
      message: 'Missing parameter: name'
    }, 'Error body');

    return t.done();
  });
};


exports['Update nic tag in use'] = function (t) {
  var net = new Network({
    name: 'foo',
    nic_tag: 'foobar',
    provision_start_ip: '10.0.2.1',
    provision_end_ip: '10.0.2.10',
    subnet: '10.0.2.0/24',
    vlan_id: 200
  });

  helpers.ufdsReturnValues({
    list: [[null, [net]]]
  });

  NAPI.updateNicTag('foobar', { name: 'bar2' }, function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InUse',
      errors: [ {
        code: 'UsedBy',
        id: net.uuid,
        message: util.format('In use by network "%s"', net.uuid),
        type: 'network'
      } ],
      message: 'Nic tag is in use'
    }, 'Error body');

    return t.done();
  });
};



// --- Teardown



exports['Stop server'] = function (t) {
  helpers.stopServer(function (err) {
    t.ifError(err, 'server stop');
    t.done();
  });
};
