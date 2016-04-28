/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for overlapping networks
 */

'use strict';

var assert = require('assert-plus');
var fmt = require('util').format;
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_fabric_net = require('../lib/fabric-net');
var mod_net = require('../lib/net');
var mod_uuid = require('node-uuid');
var mod_vlan = require('../lib/vlan');
var mod_vasync = require('vasync');
var test = require('tape');
var testIfFabricsEnabled = require('../lib/fabrics').testIfEnabled;



// --- Globals



var OWNER = mod_uuid.v4();
var NAPI = h.createNAPIclient();
var STATE = { };
var VLAN = {
    name: mod_vlan.randomName(),
    owner_uuid: OWNER,
    vlan_id: 1000
};



// --- Setup



test('setup', function (t) {

    t.test('create test nic tag', function (t2) {
        h.createNicTag(t2, NAPI, STATE);
    });


    t.test('delete previously created networks', function (t2) {
        h.deletePreviousNetworks(t2);
    });

});


testIfFabricsEnabled('create vlan', function (t) {
    mod_vlan.createAndGet(t, {
        params: VLAN,
        exp: VLAN
    });
});



// --- Tests



function testOverlap(t, testParams) {
    var created = [];
    var mod = testParams.module;
    var nameSuffix = fmt('-%s-%d', testParams.name, process.pid);
    var start = testParams.startDigit;

    assert.object(testParams, 'testParams');
    assert.object(testParams.module, 'testParams.module');
    assert.string(testParams.name, 'testParams.name');
    assert.number(testParams.startDigit, 'testParams.startDigit');


    function netParams(params) {
        if (testParams.extraNetParams) {
            for (var p in testParams.extraNetParams) {
                params[p] = testParams.extraNetParams[p];
            }
        }

        var validNet = h.validNetworkParams(params);
        if (testParams.fabric) {
            delete validNet.nic_tag;
        }

        return validNet;
    }

    var net = netParams({
        name: 'integration-overlap-testing' + nameSuffix,
        subnet: fmt('%d.2.1.64/26', start),
        provision_start_ip: fmt('%d.2.1.74', start),
        provision_end_ip: fmt('%d.2.1.120', start)
    });

    var overlappingNets = [
        // encloses it
        netParams({
            name: 'integration-overlap-testing: encloses' + nameSuffix,
            subnet: fmt('%d.2.0.0/23', start),
            provision_start_ip: fmt('%d.2.0.10', start),
            provision_end_ip: fmt('%d.2.0.20', start)
        }),

        // overlaps at the bottom
        netParams({
            name: 'integration-overlap-testing: bottom' + nameSuffix,
            subnet: fmt('%d.2.1.64/27', start),
            provision_start_ip: fmt('%d.2.1.66', start),
            provision_end_ip: fmt('%d.2.1.90', start)
        }),

        // in the middle
        netParams({
            name: 'integration-overlap-testing: middle' + nameSuffix,
            subnet: fmt('%d.2.1.80/28', start),
            provision_start_ip: fmt('%d.2.1.82', start),
            provision_end_ip: fmt('%d.2.1.93', start)
        }),

        // overlaps at the top
        netParams({
            name: 'integration-overlap-testing: middle' + nameSuffix,
            subnet: fmt('%d.2.1.112/28', start),
            provision_start_ip: fmt('%d.2.1.113', start),
            provision_end_ip: fmt('%d.2.1.124', start)
        })
    ];

    t.test('create network', function (t2) {
        mod.create(t2, {
            params: net,
            partialExp: net
        });
    });

    t.test('create overlapping networks', function (t2) {
        net.uuid = mod.lastCreated().uuid;
        created.push(net);
        t.ok(net.uuid, 'original network UUID: ' + net.uuid);

        mod_vasync.forEachPipeline({
            inputs: overlappingNets,
            func: function _createOverlapNet(oNet, cb) {
                mod.create(t2, {
                    continueOnErr: true,
                    desc: oNet.subnet,
                    params: oNet,
                    expErr: h.invalidParamErr({
                        errors: mod_err.networkOverlapParams([ net ])
                    })
                }, cb);
            }
        }, function () {
            return t2.end();
        });
    });

    // These "nearby" networks should all work:
    var nonOverlappingNets = [
        // just below
        netParams({
            name: 'integration-overlap-testing: just below' + nameSuffix,
            subnet: fmt('%d.2.1.0/26', start),
            provision_start_ip: fmt('%d.2.1.10', start),
            provision_end_ip: fmt('%d.2.1.20', start)
        }),

        // just above
        netParams({
            name: 'integration-overlap-testing: just above' + nameSuffix,
            subnet: fmt('%d.2.1.128/26', start),
            provision_start_ip: fmt('%d.2.1.130', start),
            provision_end_ip: fmt('%d.2.1.140', start)
        })
    ];

    t.test('create non-overlapping networks', function (t2) {
        mod_vasync.forEachPipeline({
            inputs: nonOverlappingNets,
            func: function _createOverlapNet(oNet, cb) {
                mod.create(t2, {
                    desc: fmt('%s (%s)', oNet.subnet, oNet.name),
                    params: oNet,
                    partialExp: oNet
                }, function (err, res) {
                    if (res) {
                        oNet.uuid = res.uuid;
                        created.push(oNet);
                    }

                    return cb(err);
                });
            }
        }, function (err) {
            t2.ifError(err, 'successfully created non-overlapping networks');
            return t2.end();
        });
    });

    // This network should now overlap with both the original network and
    // the one created just below it in the test above.
    t.test('create double-overlapping network', function (t2) {
        var params = netParams({
            name: 'integration-overlap-testing: double overlap' + nameSuffix,
            subnet: fmt('%d.2.1.0/25', start),
            provision_start_ip: fmt('%d.2.1.10', start),
            provision_end_ip: fmt('%d.2.1.120', start)
        });

        mod.create(t2, {
            desc: params.subnet,
            params: params,
            expErr: h.invalidParamErr({
                errors: mod_err.networkOverlapParams(
                    [ net, nonOverlappingNets[0] ])
            })
        });
    });
}


/*
 * There are two different cases where we want to test overlaps:
 *
 * - Regular networks are not allowed overlapping public (non-RFC1918) subnets.
 *   RFC1918 subnets are allowed to overlap.
 * - Fabric networks are only allowed RFC1918 addresses, and they are not
 *   allowed to overlap.
 */


test('Networks - overlapping subnet ranges', function (t) {
    testOverlap(t, {
        module: mod_net,
        name: 'regular',
        startDigit: 110
    });
});


testIfFabricsEnabled('Fabric networks - overlapping subnet ranges',
        function (t) {
    testOverlap(t, {
        fabric: true,
        module: mod_fabric_net,
        name: 'fabric',
        startDigit: 10,
        extraNetParams: {
            owner_uuid: OWNER,
            vlan_id: VLAN.vlan_id
        }
    });
});


test('Networks - allow overlapping RFC1918 subnets', function (t) {
    var params = h.validNetworkParams({
        subnet: '10.2.1.64/26',
        provision_start_ip: '10.2.1.74',
        provision_end_ip: '10.2.1.120'
    });

    t.test('create network: 1', function (t2) {
        params.name = 'integration-overlap-testing-1-' + process.pid;
        mod_net.create(t2, {
            params: params,
            partialExp: params
        });
    });

    t.test('create network: 2', function (t2) {
        params.name = 'integration-overlap-testing-2-' + process.pid;
        mod_net.create(t2, {
            params: params,
            partialExp: params
        });
    });
});



// --- Teardown



test('teardown', function (t) {
    t.test('remove created networks', mod_net.delAllCreated);

    t.test('remove created fabric networks', mod_fabric_net.delAllCreated);

    t.test('delete created VLANs', mod_vlan.delAllCreated);

    t.test('remove test nic tag', function (t2) {
        h.deleteNicTag(t2, NAPI, STATE);
    });
});
