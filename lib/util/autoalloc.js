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
var ipaddr = require('ip6addr');

function allocProvisionRange(subnet) {
    if (typeof (subnet) === 'string') {
        subnet = ipaddr.createCIDR(subnet);
    } else {
        assert.object(subnet);
    }
    var first = subnet.first();
    var last = subnet.last();
    return [first.toString(), last.toString()];
}

function ip(s) {
    return (ipaddr.parse(s));
}

/* Subnets overlap if s1.maximum >= s2.minimum */
var IP_10_0_0_0 = ip('10.0.0.0');
var IP_172_16_0_0 = ip('172.16.0.0');
var IP_192_168_0_0 = ip('192.168.0.0');

var IP_10_255_255_255 = ip('10.255.255.255');
var IP_172_31_255_255 = ip('172.31.255.255');

var IP_9_255_255_255 = ip('9.255.255.255');
var IP_172_15_255_255 = ip('172.15.255.255');
var IP_192_167_255_255 = ip('192.167.255.255');
var IP_172_31_255_0 = ip('172.31.255.0');
var IP_172_32_0_0 = ip('172.32.0.0');

var IP_11_0_0_0 = ip('11.0.0.0');
var IP_192_169_0_0 = ip('192.169.0.0');
var IP_10_255_255_0 = ip('10.255.255.0');

function previousAddr(addr) {
    if (addr.compare(IP_10_0_0_0) === 0) {
        throw new Error('address should always be decrementable');
    } else if (addr.compare(IP_172_16_0_0) === 0) {
        return IP_10_255_255_255;
    } else if (addr.compare(IP_192_168_0_0) === 0) {
        return IP_172_31_255_255;
    } else {
        return addr.offset(-1);
    }
}

function subnetsAdjacent(sn1, sn2) {
    assert.ok(sn1.compare(sn2) < 0);
    var prev = previousAddr(sn2.address());
    return sn1.contains(prev);
}

/*
 * We percieve a gap between two subnets when they don't overlap and are not
 * adjacent.
 */
function haveGapBetweenSubnets(s1, s2) {
    return (!subnetsAdjacent(s1, s2));
}


/*
 * We decrement a subnet's prefix by one, return NULL if we can't.
 */
function decSubImpl(sub, plen) {
    var new_addr = sub.address().offset(-1);
    if (new_addr.compare(IP_9_255_255_255) === 0) {
        return null;
    } else if (new_addr.compare(IP_172_15_255_255) === 0) {
        new_addr = IP_10_255_255_0;
    } else if (new_addr.compare(IP_192_167_255_255) === 0) {
        new_addr = IP_172_31_255_0;
    }

    return ipaddr.createCIDR(new_addr, plen);
}

/*
 * We increment a subnet's prefix by one, return NULL if we can't.
 */
function incSubImpl(sub, plen) {
    var new_addr = sub.last().offset(2);
    if (new_addr.compare(IP_11_0_0_0) === 0) {
        new_addr = IP_172_16_0_0;
    } else if (new_addr.compare(IP_172_32_0_0) === 0) {
        new_addr = IP_192_168_0_0;
    } else if (new_addr.compare(IP_192_169_0_0) === 0) {
        return null;
    }

    return ipaddr.createCIDR(new_addr, plen);
}

/*
 * Increment a subnet's prefix, but restrict the prefix length of the resulting
 * subnet to 'nlen'-bits.
 *
 *  10.88.0.0/16 ===> 10.89.0.0/'nlen'
 */
function incrementSubnet(cidr, nlen) {
    assert.number(nlen, 'nlen');
    var plen = cidr.prefixLength();
    var adjustedCIDR = ipaddr.createCIDR(cidr.address(), Math.min(plen, nlen));
    return incSubImpl(adjustedCIDR, nlen);
}

/*
 * Decrements a subnet's prefix, but restrict the prefix length of the resulting
 * subnet to 'nlen'-bits.
 *
 *  10.89.0.0/16 ===> 10.88.0.0/'nlen'
 */
function decrementSubnet(cidr, nlen) {
    assert.number(nlen, 'nlen');
    var plen = cidr.prefixLength();
    var adjustedCIDR = ipaddr.createCIDR(cidr.address(), Math.min(plen, nlen));
    return decSubImpl(adjustedCIDR, nlen);
}

module.exports = {
    allocProvisionRange: allocProvisionRange,
    decrementSubnet: decrementSubnet,
    incrementSubnet: incrementSubnet,
    haveGapBetweenSubnets: haveGapBetweenSubnets,
    subnetsAdjacent: subnetsAdjacent
};
