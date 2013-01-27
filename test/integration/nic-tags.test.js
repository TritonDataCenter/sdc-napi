/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /nic-tags endpoints
 */

var helpers = require('./helpers');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var state = {
  nicTags: []
};



// --- Tests



exports['POST /nic_tags'] = function (t) {
  var createNicTag = function (name, cb) {
    napi.createNicTag(name, function (err, res) {
      t.ifError(err, 'create test nic tag: ' + name);
      if (err) {
        return cb(err);
      }
      t.ok(res.uuid, 'test nic tag '+ name + ' uuid: ' + res.uuid);
      state.nicTags.push(res);

      return napi.getNicTag(res.name, function (err2, res2) {
        t.ifError(err, 'get nic tag: ' + name);
        if (err) {
          return cb(err);
        }
        t.deepEqual(res2, res, 'get params for ' + name);
        return cb();
      });
    });
  };

  var tagNames = ['networks_integration_' + process.pid + '_1',
    'networks_integration_' + process.pid + '_2'];

  vasync.forEachParallel({
    inputs: tagNames,
    func: createNicTag
  }, function (err, res) {
    return t.done();
  });
};


exports['GET /nic_tags'] = function (t) {
  napi.listNicTags(function (err, res) {
    t.ifError(err, 'get nic tags');
    // Don't assume that there are no other nic tags
    var tag0 = state.nicTags[0];
    var tag1 = state.nicTags[1];
    var found = 0;
    t.ok(res.length !== 0, 'tags in list');

    for (var i = 0; i < res.length; i++) {
      var cur = res[i];
      if (cur.uuid == tag0.uuid) {
        t.deepEqual(cur, tag0, 'tag0 in list: ' + tag0.name);
        found++;
      }

      if (cur.uuid == tag1.uuid) {
        t.deepEqual(cur, tag1, 'tag1 in list: ' + tag1.name);
        found++;
      }
    }

    t.equal(found, 2, 'both tags found in list');
    return t.done();
  });
};


exports['DELETE /nic_tags'] = function (t) {
  vasync.forEachParallel({
    inputs: state.nicTags,
    func: function (tag, cb) {
      napi.deleteNicTag(tag.name, function (err) {
        t.ifError(err, 'delete test nic tag ' + tag.name);
        cb(err);
      });
    }
  }, function (err, res) {
    return t.done();
  });
};
