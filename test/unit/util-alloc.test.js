/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

'use strict';
var test = require('tape');
var mod_alloc = require('../../lib/util/autoalloc');
var ipaddr = require('ip6addr');
var assert = require('assert');

function c(s) {
    return (ipaddr.createCIDR(s));
}


// --- Unit test functions in lib/util/autoalloc.js

test('Alloc Utility Functions', function (t) {
    t.test('incrementSubnets', function (t2) {
        var incrementSubnet = mod_alloc.incrementSubnet;
        t2.deepEqual(null, incrementSubnet(c('192.168.255.0/24'),
            24));
        t2.deepEqual(c('10.0.1.0/24'), incrementSubnet(c('10.0.0.0/24'), 24));
        t2.deepEqual(c('172.16.0.0/24'),
            incrementSubnet(c('10.255.255.0/24'), 24));
        t2.deepEqual(c('192.168.0.0/24'),
            incrementSubnet(c('172.31.255.0/24'), 24));
        t2.deepEqual(c('10.0.3.0/24'),
            incrementSubnet(c('10.0.2.0/25'), 24));
        t2.deepEqual(c('10.2.0.0/24'),
            incrementSubnet(c('10.1.2.128/16'), 24));
        t2.deepEqual(c('172.16.0.0/18'),
            incrementSubnet(c('10.255.0.0/16'), 18));
        t2.end();
    });
    t.test('decrementSubnets', function (t2) {
        var decrementSubnet = mod_alloc.decrementSubnet;
        t2.deepEqual(null, decrementSubnet(c('10.0.0.0/24'), 24));
        t2.deepEqual(c('10.0.0.0/24'),
            decrementSubnet(c('10.0.1.0/24'), 24));
        t2.deepEqual(c('10.255.255.0/24'),
            decrementSubnet(c('172.16.0.0/24'), 24));
        t2.deepEqual(c('10.255.192.0/18'),
            decrementSubnet(c('172.16.0.0/16'), 18));
        t2.deepEqual(c('172.31.255.0/24'),
            decrementSubnet(c('192.168.0.0/24'), 24));
        t2.deepEqual(c('10.0.1.0/24'),
            decrementSubnet(c('10.0.2.128/25'), 24));
        t2.deepEqual(c('10.0.255.0/24'),
            decrementSubnet(c('10.1.2.128/16'), 24));

        t2.end();
    });
});

test('Adjacency Tests', function (t) {

    // Moving up through /24s:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.0.0/24'), c('10.0.1.0/24')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.1.0/24'), c('10.0.2.0/24')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.2.0/24'), c('10.0.3.0/24')),
        true);

    // Non-adjacent /24s:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.0.0/24'), c('10.0.2.0/24')),
        false);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.5.0/24'),
        c('172.16.0.0/24')), false);
    assert.equal(mod_alloc.subnetsAdjacent(c('172.16.0.0/24'),
        c('172.16.2.0/24')), false);
    assert.equal(mod_alloc.subnetsAdjacent(c('192.168.0.0/24'),
        c('192.168.2.0/24')), false);

    // Adjacent subnets of different prefix lengths:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.1.128/25'),
        c('10.0.2.0/26')), true);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.1.0/24'), c('10.0.2.0/26')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.1.0/24'), c('10.0.2.0/30')),
        true);

    // Non-adjacent subnets of different prefix lengths:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.0.0/25'), c('10.0.1.0/24')),
        false);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.1.0/30'), c('10.0.2.0/24')),
        false);
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.2.0/32'), c('10.0.3.0/24')),
        false);

    // Ignore non-RFC 1918 spaces for the purposes of adjacency:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.0.0/8'), c('172.16.0.0/30')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('172.31.0.0/16'),
        c('192.168.0.0/26')), true);

    // Non-adjacent spaces:
    assert.equal(mod_alloc.subnetsAdjacent(c('10.0.0.0/24'),
        c('172.16.0.0/30')), false);
    assert.equal(mod_alloc.subnetsAdjacent(c('172.31.0.0/24'),
        c('192.168.0.0/26')), false);

    // IPv6 ULA adjacent:
    assert.equal(mod_alloc.subnetsAdjacent(c('fd00::/16'), c('fd01::/16')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('fd01::/16'), c('fd02::/16')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('fd00:3::/32'), c('fd00:4::/32')),
        true);
    assert.equal(mod_alloc.subnetsAdjacent(c('fd00:3::/32'), c('fd00:4::/64')),
        true);

    // IPv6 ULA non-adjacent:
    assert.equal(mod_alloc.subnetsAdjacent(c('fd00::/16'), c('fd02::/16')),
        false);
    assert.equal(mod_alloc.subnetsAdjacent(c('fd00::/16'), c('fd4e::/16')),
        false);
    t.end();

});
