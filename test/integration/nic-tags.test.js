/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Integration tests for /nic-tags endpoints
 */

var h = require('./helpers');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
var state = {
    nicTags: []
};



// --- Tests



test('POST /nic_tags', function (t) {
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
        return t.end();
    });
});


test('GET /nic_tags', function (t) {
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
        return t.end();
    });
});


test('DELETE /nic_tags', function (t) {
    vasync.forEachParallel({
        inputs: state.nicTags,
        func: function (tag, cb) {
            napi.deleteNicTag(tag.name, function (err) {
                t.ifError(err, 'delete test nic tag ' + tag.name);
                cb(err);
            });
        }
    }, function (err, res) {
        return t.end();
    });
});
