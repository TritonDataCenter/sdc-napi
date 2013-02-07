/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI integration tests
 */

var assert = require('assert');
var bunyan = require('bunyan');
var config = require('../../lib/config');
var common = require('../lib/common');
var fs = require('fs');
var NAPI = require('sdc-clients').NAPI;
var path = require('path');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var CONFIG_FILE = path.normalize(__dirname + '/../../config.json');



// --- Exported functions



/*
 * Creates a NAPI client for the local zone
 */
function createNAPIclient() {
  var conf = config.load(CONFIG_FILE);
  return new NAPI({
    url: 'http://localhost:' + conf.port
  });
}


/**
 * Creates a nic tag for testing; stores the result in state.nicTag, or
 * state[targetName] if targetName is specified
 */
function createNicTag(t, napi, state, targetName, callback) {
  var name = 'nictag_integration_' + process.pid;
  if (targetName) {
    if (typeof (targetName) === 'function') {
      callback = targetName;
      targetName = null;
    } else {
      name = name + '_' + targetName;
    }
  }

  napi.createNicTag(name, function (err, res) {
      t.ifError(err, 'create test nic tag "' + name + '"');
      if (res) {
        t.ok(res.uuid,
          util.format('test nic tag: uuid=%s, name=%s', res.uuid, res.name));
        if (targetName) {
          state[targetName] = res;
        } else {
          state.nicTag = res;
        }

        if (!state.hasOwnProperty('nic_tags')) {
          state.nic_tags = [];
        }

        state.nic_tags.push(res);
      }

      if (callback) {
        return callback(err, res);
      } else {
        return t.done();
      }
  });
}


/**
 * Creates all of the nic tags specified in tags
 */
function createNicTags(t, napi, state, tags, callback) {
  vasync.forEachParallel({
    inputs: tags,
    func: createNicTag.bind(null, t, napi, state)
  }, function (err, res) {
    if (callback) {
      return callback(err, res);
    }

    return t.done();
  });
}


/**
 * Deletes the testing nic tag stored in state.nicTag or state[name], if
 * name is specified
 */
function deleteNicTag(t, napi, state, name, callback) {
  var tagName = state.nicTag.name;
  if (name) {
    if (typeof (name) === 'function') {
      callback = name;
      name = null;
    } else {
      tagName = state[name].name;
    }
  }


  napi.deleteNicTag(tagName, function (err) {
    t.ifError(err, 'delete test nic tag: ' + tagName);
    if (callback) {
      return callback(err);
    }

    return t.done();
  });
}


/**
 * Deletes all nic tags in state.nic_tags
 */
function deleteNicTags(t, napi, state) {
  if (!state.hasOwnProperty('nic_tags') || state.nic_tags.length === 0) {
    return t.done();
  }

  vasync.forEachParallel({
    inputs: state.nic_tags,
    func: function _delNicTag(tag, cb) {
      napi.deleteNicTag(tag.name, function (err) {
        t.ifError(err, 'delete test nic tag: ' + tag.name);

        // We're calling this in teardown, so plow on anyway with deleting
        // the rest of the tags
        return cb();
      });
    }
  }, function (err) {
    return t.done();
  });
}


/*
 * Creates a network for testing; stores the result in state.network
 */
function createNetwork(t, napi, state, extraParams, targetName, callback) {
  var params = {
    name: 'network-integration-' + process.pid,
    vlan_id: 0,
    subnet: '10.99.99.0/24',
    provision_start_ip: '10.99.99.5',
    provision_end_ip: '10.99.99.250',
    nic_tag: state.nicTag.name
  };

  if (typeof (targetName) === 'function') {
    callback = targetName;
    targetName = null;
  }

  if (targetName) {
    params.name = params.name + '-' + targetName;
  }

  for (var p in extraParams) {
    params[p] = extraParams[p];
  }

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      if (callback) {
        return callback(err);
      }
      return t.done();
    }

    t.ok(res.uuid, 'test network uuid: ' + res.uuid);

    params.uuid = res.uuid;
    params.resolvers = [];
    params.netmask = util_ip.bitsToNetmask(params.subnet.split('/')[1]);
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
    if (targetName) {
      state[targetName] = res;
    } else {
      state.network = res;
    }

    if (callback) {
      return callback();
    }
    return t.done();
  });
}


/**
 * Deletes the testing network stored in state.network
 */
function deleteNetwork(t, napi, state, name, callback) {
  var net = state.network;
  if (name) {
    if (typeof (name) === 'function') {
      callback = name;
    } else {
      net = state[name];
    }
  }

  napi.deleteNetwork(net.uuid, { force: true }, function (err) {
    t.ifError(err, 'delete network');
    if (callback) {
      return callback(err);
    }

    return t.done();
  });
}


/**
 * Logs relevant information about the error, and ends the test
 */
function doneWithError(t, err, desc) {
  t.ifError(err, desc);

  if (err.body.hasOwnProperty('errors')) {
    t.deepEqual(err.body.errors, {}, 'display body errors');
  }
  return t.done();
}


/**
 * Asserts that substr is a substring or match for str. Similar to tap's
 * similar() (that's a little test humour for you).
 */
function similar(t, str, substr, message) {
  t.ok((str.indexOf(substr) !== -1) || (str == substr), message);
}



module.exports = {
  createNAPIclient: createNAPIclient,
  createNetwork: createNetwork,
  createNicTag: createNicTag,
  createNicTags: createNicTags,
  deleteNetwork: deleteNetwork,
  deleteNicTag: deleteNicTag,
  deleteNicTags: deleteNicTags,
  doneWithError: doneWithError,
  invalidParamErr: common.invalidParamErr,
  randomMAC: common.randomMAC,
  similar: similar
};
