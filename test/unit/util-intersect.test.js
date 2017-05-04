/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../../lib/util/constants');
var errors = require('../../lib/util/errors');
var mod_jsprim = require('jsprim');
var Network = require('../../lib/models/network').Network;
var NetworkPool = require('../../lib/models/network-pool').NetworkPool;
var test = require('tape');
var util = require('util');
var util_intersect = require('../../lib/util/intersect');


// --- Globals

var getPoolIntersections = util_intersect.getPoolIntersections;

function mkNet(nic_tag, vlan_id, vnet_id, mtu) {
    assert.string(nic_tag, 'nic_tag');
    assert.number(vlan_id, 'vlan_id');

    return {
        mtu: mtu || constants.MTU_DEFAULT,
        nic_tag: nic_tag,
        vlan_id: vlan_id,
        vnet_id: vnet_id
    };
}

function mkPool(networks) {
    var nic_tags = [];
    networks.forEach(function (network) {
        var nic_tag = network.nic_tag;
        if (nic_tags.indexOf(nic_tag) === -1) {
            nic_tags.push(nic_tag);
        }
    });

    return new NetworkPool({
        _netobjs: networks.map(function (network) {
            // Add fields to make the parameters valid:
            var params = mod_jsprim.mergeObjects({
                subnet: '10.0.0.0/24',
                subnet_start_ip: '10.0.0.0',
                fabric: network.vnet_id !== undefined
            }, network);

            return new Network(params);
        })
    });
}

var a_0 = mkNet('a', 0);
var a_1 = mkNet('a', 1);
var b_0 = mkNet('b', 0);
var b_1 = mkNet('b', 1);
var b_0_1 = mkNet('b', 0, 1);
var c_2 = mkNet('c', 2, undefined, 9000);
var c_3_200 = mkNet('c', 3, 200);
var c_4 = mkNet('c', 4);
var c_5_1234 = mkNet('c', 5, 1234);
var q_60_8000 = mkNet('q', 60, 8000);

// --- Internal helpers


function mixedError(pool) {
    return errors.missingParam('nic_tags_available',
        util.format(constants.fmt.POOL_NIC_TAGS_AMBIGUOUS, pool.uuid));
}

function testInvalid(t, filter, pools, exp) {
    try {
        getPoolIntersections('addresses_updates', filter, pools);
        t.fail('Expected intersection calculation to fail');
    } catch (e) {
        t.deepEqual(e, exp, 'proper error thrown');
    }
}

// --- Tests

test('single pool', function (t) {
    var setA = [ a_0, a_1, b_0, c_2 ];
    var input = [
        mkPool(setA)
    ];

    t.deepEqual(getPoolIntersections('addresses_updates',
        { vlan_id: 0, nic_tags_available: [ 'a', 'b' ] },
        input), [ a_0, b_0 ], 'nic_tags_available=[a,b] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'a', 'c' ] },
        input), [ a_0, a_1, c_2 ], 'nic_tags_available=[a,c] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'a', 'd' ] },
        input), [ a_0, a_1 ], 'nic_tags_available=[a,d] filter');

    t.deepEqual(getPoolIntersections('addresses_updates', { nic_tag: 'a' },
        input), [ a_0, a_1 ], 'vlan_id=0 filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tag: 'a', vlan_id: 0 },
        input), [ a_0 ], 'nic_tag=a, vlan_id=0 filter');

    t.end();
});


test('two pools', function (t) {
    var setA = [ a_0, a_1, b_0, b_1, q_60_8000 ];
    var setB = [ a_1, c_2, a_0, c_3_200, q_60_8000 ];
    var input = [
        mkPool(setA),
        mkPool(setB)
    ];

    testInvalid(t, {}, input, mixedError(input[0]));

    testInvalid(t, { vlan_id: 0 }, input, mixedError(input[0]));

    testInvalid(t, { vnet_id: 8000 }, input, mixedError(input[0]));

    t.deepEqual(getPoolIntersections('addresses_updates', { nic_tag: 'a' },
        input), [ a_0, a_1 ], 'nic_tag=a filter');

    t.deepEqual(getPoolIntersections('addresses_updates', { nic_tag: 'q' },
        input), [ q_60_8000 ], 'nic_tag=q filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'q', 'a' ] },
        input), [ a_0, a_1, q_60_8000 ], 'nic_tags_available=[q,a] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'a', 'b' ] },
        input), [ a_0, a_1 ], 'nic_tags_available=[a,b] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tag: 'a', vlan_id: 0 },
        input), [ a_0 ], 'nic_tag=a, vlan_id=0 filter');

    t.end();
});


test('five pools', function (t) {
    var setA = [ a_0, c_2, c_3_200 ];
    var setB = [ b_0_1, c_2, c_3_200, a_0 ];
    var setC = [ b_0_1, c_2, a_0, b_0_1 ];
    var setD = [ a_1, b_0_1, c_2, a_0 ];
    var setE = [ q_60_8000, c_2, a_0 ];
    var input = [
        mkPool(setA),
        mkPool(setB),
        mkPool(setC),
        mkPool(setD),
        mkPool(setE)
    ];

    testInvalid(t, {}, input, mixedError(input[0]));

    testInvalid(t, { vlan_id: 0 }, input, mixedError(input[0]));

    testInvalid(t, { vlan_id: 2 }, input, mixedError(input[0]));

    t.deepEqual(getPoolIntersections('addresses_updates', { nic_tag: 'a' },
        input), [ a_0 ], 'nic_tag=a filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'a', 'c' ] },
        input), [ a_0, c_2 ], 'nic_tags_available=[a,c] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'c' ] },
        input), [ c_2 ], 'nic_tags_available=[c] filter');

    t.deepEqual(getPoolIntersections('addresses_updates',
        { nic_tags_available: [ 'c', 'q' ] },
        input), [ c_2 ], 'nic_tags_available=[c,q] filter');

    t.deepEqual(getPoolIntersections('addresses_updates', { nic_tag: 'c' },
        input), [ c_2 ], 'nic_tag=c filter');

    t.end();
});


test('missing nic_tag hints okay w/ homogenous pools', function (t) {
    var setA = [ c_2, c_3_200, c_5_1234 ];
    var setB = [ c_2, c_4, c_5_1234 ];
    var setC = [ c_2, c_3_200, c_4, c_5_1234 ];
    var setD = [ c_2, c_5_1234 ];
    var input = [
        mkPool(setA),
        mkPool(setB),
        mkPool(setC),
        mkPool(setD)
    ];

    t.deepEqual(getPoolIntersections('addresses_updates', {}, input),
        [ c_2, c_5_1234 ], 'no filter given');

    t.deepEqual(getPoolIntersections('addresses_updates', { vlan_id: 2 },
        input), [ c_2 ], 'vlan_id filter given');

    t.deepEqual(getPoolIntersections('addresses_updates', { vlan_id: 5 },
        input), [ c_5_1234 ], 'vlan_id filter given');

    t.deepEqual(getPoolIntersections('addresses_updates', { vnet_id: 1234 },
        input), [ c_5_1234 ], 'vnet_id filter given');

    t.deepEqual(getPoolIntersections('addresses_updates', { mtu: 9000 },
        input), [ c_2 ], 'mtu filter given');

    t.end();
});


test('no intersection', function (t) {
    // All of these have c_2 except for the last
    var setA = [ c_2 ];
    var setB = [ b_0_1, c_2, c_3_200, a_0 ];
    var setC = [ b_0_1, c_2, a_0, b_0_1 ];
    var setD = [ a_1, b_0_1, c_2, a_0 ];
    var setE = [ q_60_8000 ];
    var input = [
        mkPool(setA),
        mkPool(setB),
        mkPool(setC),
        mkPool(setD),
        mkPool(setE)
    ];

    var all_tags = [ 'a', 'b', 'c', 'd', 'q' ];

    var ambiguous = errors.missingParam('nic_tags_available',
        util.format(constants.fmt.POOL_NIC_TAGS_AMBIGUOUS, input[1].uuid));

    var constrained = errors.invalidParam('addresses_updates',
        util.format(constants.fmt.POOL_FAILS_CONSTRAINTS, input[4].uuid));

    testInvalid(t, {}, input, ambiguous);

    testInvalid(t, { vlan_id: 2 }, input, ambiguous);

    testInvalid(t, { nic_tags_available: all_tags }, input,
        errors.invalidParam('addresses_updates',
            constants.msg.NO_POOL_INTERSECTION));

    testInvalid(t, { nic_tags_available: [ 'c' ] }, input,
        constrained);

    testInvalid(t, { vlan_id: 2, nic_tags_available: all_tags }, input,
        constrained);

    t.end();
});
