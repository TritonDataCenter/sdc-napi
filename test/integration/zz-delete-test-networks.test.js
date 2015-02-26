/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Delete all networks created during tests - useful to run if you have
 * tests that crash half-way through
 */

var common = require('../lib/common');
var fmt = require('util').format;
var h = require('./helpers');
var test = require('tape');
var vasync = require('vasync');



// --- Globals



var NAPI = h.createNAPIclient();
// Regexes that match the network name:
var REs = [
    /* jsl:ignore (for "regular expressions should be preceded ..." warning) */
    /^test-fabric-net\d-\d+$/,
    /^test-overlap-net\d-\d+$/,
    /^network-integration-\d+-\d$/,
    /^integration-overlap-testing/
    /* jsl:end */
];



test('delete test networks', function (t) {
    NAPI.listNetworks({}, function (err, nets) {
        if (h.ifErr(t, err, 'listing')) {
            return t.end();
        }

        if (nets.length === 0) {
            t.ok(true, 'No networks found');
            return t.end();
        }

        var deleted = [];
        var toDel = [];
        var uuids = [];

        nets.forEach(function (net) {
            var uuid = net.uuid;

            REs.forEach(function (re) {
                if (net.name.match(re) && uuids.indexOf(uuid) === -1) {
                    toDel.push(net);
                }
            });
        });

        if (toDel.length === 0) {
            t.ok(true, 'No test networks found');
            return t.end();
        }

        vasync.forEachParallel({
            inputs: toDel,
            func: function _delNet(net, cb) {
                var desc = fmt('delete: uuid=%s, name=%s', net.uuid, net.name);
                NAPI.deleteNetwork(net.uuid,  {}, common.reqOpts(t, desc),
                        function _afterDel(dErr) {
                    if (h.ifErr(t, dErr, desc)) {
                        return cb();
                    }

                    t.ok(true, desc + ' deleted');
                    deleted.push(net);
                    return cb();
                });
            }
        }, function () {
            t.equal(deleted.length, toDel.length, 'all networks deleted');
            return t.end();
        });
    });
});
