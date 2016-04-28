/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for /nic-tags endpoints
 */

'use strict';

var h = require('./helpers');
var mod_nic_tag = require('../lib/nic-tag');
var test = require('tape');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
var state = {
    nicTags: []
};



// --- Tests



test('POST /nic_tags', function (t) {
    function createNicTag(name, cb) {
        mod_nic_tag.createAndGet(t, {
            name: name,
            params: {
                mtu: 1510
            },
            exp: {
                mtu: 1510,
                name: name
            },
            state: state,
            stateProp: 'nicTags'
        }, cb);
    }

    var tagNames = ['networks_integration_' + process.pid + '_1',
        'networks_integration_' + process.pid + '_2'];

    vasync.forEachParallel({
        inputs: tagNames,
        func: createNicTag
    }, function (err) {
        t.ifError(err, 'creating NIC tags should succeed');
        t.end();
    });
});


test('GET /nic_tags', function (t) {
    mod_nic_tag.list(t, {
        present: state.nicTags
    });
});


test('PUT /nic_tags/:name', function (t) {

    t.test('Update MTU only', function (t2) {
        state.nicTags[0].mtu = 1520;

        mod_nic_tag.updateAndGet(t2, {
            name: state.nicTags[0].name,
            params: {
                mtu: 1520
            },
            exp: state.nicTags[0]
        });
    });


    t.test('Update name only', function (t2) {
        var oldName = state.nicTags[0].name;
        // Make sure this new name isn't over the 31 char limit:
        state.nicTags[0].name = 'int_test' + process.pid + '_new';

        mod_nic_tag.updateAndGet(t2, {
            name: oldName,
            params: {
                name: state.nicTags[0].name
            },
            exp: state.nicTags[0]
        });
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
    }, function (err) {
        t.ifError(err, 'deleting NIC tags should succeed');
        t.end();
    });
});
