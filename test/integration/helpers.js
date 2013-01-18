/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI integration tests
 */

var assert = require('assert');
var bunyan = require('bunyan');
var config = require('../../lib/config');
var fs = require('fs');
var NAPI = require('sdc-clients').NAPI;
var path = require('path');
var test = require('tap').test;
var UFDS = require('../../lib/ufds');
var util = require('util');



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


/*
 * Creates a nic tag for testing; stores the result in nicTag
 */
function createNicTag(t, napi, state, targetName) {
  var name = 'nictag_integration_' + process.pid;
  if (targetName) {
    name = name + '_' + targetName;
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
      }
      return t.done();
  });
}


/*
 * Deletes the testing nic tag stored in state.nicTag
 */
function deleteNicTag(t, napi, state, name) {
  var tagName = name ? state[name].name : state.nicTag.name;

  napi.deleteNicTag(tagName, function (err) {
    t.ifError(err, 'delete test nic tag: ' + tagName);
    return t.done();
  });
}


/*
 * Creates a network for testing; stores the result in state.network
 */
function createNetwork(t, napi, state, extraParams, targetName) {
  var params = {
    name: 'network-integration-' + process.pid,
    vlan_id: 0,
    subnet: '10.99.99.0/24',
    provision_start_ip: '10.99.99.5',
    provision_end_ip: '10.99.99.250',
    nic_tag: state.nicTag.name
  };

  if (targetName) {
    params.name = params.name + '-' + targetName;
  }

  for (var p in extraParams) {
    params[p] = extraParams[p];
  }

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      return t.done();
    }

    t.ok(res.uuid, 'test network uuid: ' + res.uuid);

    params.uuid = res.uuid;
    params.resolvers = [];
    params.netmask = '255.255.255.0';
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
    if (targetName) {
      state[targetName] = res;
    } else {
      state.network = res;
    }

    return t.done();
  });
}


/*
 * Deletes the testing network stored in state.network
 */
function deleteNetwork(t, napi, state, name) {
  var net = name ? state[name]: state.network;

  napi.deleteNetwork(net.uuid, { force: true }, function (err) {
    t.ifError(err, 'delete network');
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


/*
 * Generate a valid random MAC address (multicast bit not set, locally
 * administered bit set)
 */
function randomMAC() {
  var data = [(Math.floor(Math.random() * 15) + 1).toString(16) + 2];
  for (var i = 0; i < 5; i++) {
     var oct = (Math.floor(Math.random() * 255)).toString(16);
     if (oct.length == 1) {
        oct = '0' + oct;
     }
     data.push(oct);
  }

  return data.join(':');
}


/*
 * Creates a UFDS client, storing it in state.ufds
 */
function createUFDSclient(t, state, callback) {
  var ufds_client = require('sdc-clients').UFDS;
  var conf = config.load(CONFIG_FILE);

  state.baseDN = conf.ufds.baseDN;
  var client = new ufds_client(conf.ufds);

  var errCb = function (err) {
    return callback(err);
  };

  client.on('error', errCb);

  client.on('ready', function () {
    client.removeListener('error', errCb);
    state.ufds = client;
    return callback(null);
  });
}


/*
 * Add a record to UFDS
 */
function ufdsAdd(state, dn, toAdd, callback) {
  state.ufds.client.add(util.format('%s, %s', dn, state.baseDN),
    toAdd, callback);
}


/*
 * Destroys the UFDS client in state.ufds
 */
function destroyUFDSclient(t, state, callback) {
  if (!state.ufds) {
    return callback(null);
  }
  return state.ufds.close(function (err) {
    t.ifError(err, 'UFDS client close');
    return t.done();
  });
}


module.exports = {
  createNAPIclient: createNAPIclient,
  createUFDSclient: createUFDSclient,
  createNetwork: createNetwork,
  createNicTag: createNicTag,
  deleteNetwork: deleteNetwork,
  deleteNicTag: deleteNicTag,
  destroyUFDSclient: destroyUFDSclient,
  doneWithError: doneWithError,
  randomMAC: randomMAC,
  similar: similar,
  ufdsAdd: ufdsAdd
};
