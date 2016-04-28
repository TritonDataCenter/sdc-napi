/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * IP-related utilities
 */

'use strict';

var ipaddr = require('ipaddr.js');
var net = require('net');


var MAX_IP = 4294967295;


/*
 * Converts a dotted IPv4 address (eg: 1.2.3.4) to its integer value
 */
function addressToNumber(addr) {
    if (!addr || !net.isIPv4(addr)) {
        return null;
    }

    var octets = addr.split('.');
    return Number(octets[0]) * 16777216 +
        Number(octets[1]) * 65536 +
        Number(octets[2]) * 256 +
        Number(octets[3]);
}


/*
 * Idempotent conversion from strings (and numbers) to ipaddr.js objects
 */
function toIPAddr(addr) {
    if (addr instanceof ipaddr.IPv4 || addr instanceof ipaddr.IPv6) {
        return addr;
    }
    if (typeof (addr) === 'object' && addr !== null) {
        if (addr.octets)
            return ipaddr.parse(addr.octets.join('.'));
        else if (addr.parts)
            return ipaddr.parse(addr.parts.join(':'));
    }
    // XXX We want to be able to parse numbers as IP addresses to support the
    // legacy IP tables where addresses were stored as numbers. ipaddr.js will
    // parse decimal numbers (in string form) as IP addresses for IPv4 (see
    // https://github.com/whitequark/ipaddr.js/issues/7)
    // However, since ipaddr.js parses strings, when previously an IP address
    // parameter like '1' would not be accepted, it is now parsed as 0.0.0.1
    if (typeof (addr) === 'number') {
        addr = addr.toString();
    }

    if (!ipaddr.isValid(addr)) {
        return null;
    }

    return ipaddr.parse(addr);
}


/**
 * Return an IPv6 address object, regardless of whether it's a v4 or v6
 * input address
 */
function toIP6Addr(addr) {
    if (addr instanceof ipaddr.IPv4 || addr instanceof ipaddr.IPv6) {
        return addr;
    }

    var ipObj = ipaddr.process(addr);
    if (ipObj.kind() === 'ipv4') {
        ipObj = ipObj.toIPv4MappedAddress();
    }

    return ipObj;
}


function ipAddrPlus(addr, summand) {
    // clone since we'll be modifying the underlying representation
    addr = ipaddr.parse(toIPAddr(addr).toString());

    // ipaddr.js uses arrays of numbers for its underlying representation of
    // IPs.
    // For IPv4, the 'octets' array has four numbers up to and including 255.
    // For IPv6, the 'parts' array has eight numbers up to and including 65535.
    var max, under;
    if (addr.kind() === 'ipv4') {
        max = Math.pow(2, 8);
        under = 'octets';
    } else {
        max = Math.pow(2, 16);
        under = 'parts';
    }

    var place = addr[under].length - 1;
    addr[under][place] += summand;
    var carry = Math.floor(addr[under][place] / max);
    while (carry !== 0 && place >= 1) {
        addr[under][place - 1] += carry;
        addr[under][place] -= carry * max;
        carry = Math.floor(addr[under][place - 1] / max);
        place--;
    }

    // TODO better errors
    if (carry > 0) {
        throw new Error('overflow!');
    } else if (carry < 0) {
        throw new Error('underflow!');
    }
    return (addr);
}


function ipAddrMinus(addr, minuend) {
    return ipAddrPlus(addr, -minuend);
}


/*
 * Returns true if the IP passed in is in any of the RFC1918 private
 * address spaces
 */
function isRFC1918(ip) {
    var num = ip;

    if (net.isIPv6(ip)) {
        return false;
    }

    if (isNaN(num)) {
        num = addressToNumber(ip);
    }

    // 10.0.0.0/8: 10.0.0.0 - 10.255.255.255
    if (num >= 167772160 && num <= 184549375) {
        return true;
    }

    // 172.16.0.0/12: 172.16.0.0 - 172.31.255.255
    if (num >= 2886729728 && num <= 2887778303) {
        return true;
    }

    // 192.168.0.0/16: 192.168.0.0 - 192.168.255.255
    if (num >= 3232235520 && num <= 3232301055) {
        return true;
    }

    return false;
}


/*
 * Compares two IP addresses
 */
function compareTo(a, b) {
    a = toIPAddr(a);
    b = toIPAddr(b);

    if (!a || !b) {
        return null;
    }

    if (a.kind() !== b.kind()) {
        if (a.kind() === 'ipv4') {
            a = a.toIPv4MappedAddress();
        } else {
            b = b.toIPv4MappedAddress();
        }
    }

    var abytes = a.toByteArray();
    var bbytes = b.toByteArray();
    var i;

    // big-endian arrays
    for (i = 0; i < abytes.length; i++) {
        if (abytes[i] !== bbytes[i]) {
            return abytes[i] - bbytes[i];
        }
    }
    return 0;
}


/*
 * Converts an integer to a dotted IP address
 */
function numberToAddress(num) {
    if (isNaN(num) || num > 4294967295 || num < 0) {
        return null;
    }

    var a = Math.floor(num / 16777216);
    var aR = num - (a * 16777216);
    var b = Math.floor(aR / 65536);
    var bR = aR - (b * 65536);
    var c = Math.floor(bR / 256);
    var d = bR - (c * 256);

    return a + '.' + b + '.' + c + '.' + d;
}


/*
 * Converts CIDR (/xx) bits to netmask
 */
function bitsToNetmask(bits) {
    var n = 0;

    for (var i = 0; i < (32 - bits); i++) {
        n |= 1 << i;
    }
    return numberToAddress(MAX_IP - n);
}


/*
 * Converts netmask to CIDR (/xx) bits
 */
function netmaskToBits(netmask) {
    var num = ~addressToNumber(netmask);
    var b = 0;
    for (b = 0; b < 32; b++) {
        if (num === 0) {
            break;
        }
        num = num >>> 1;
    }
    return 32 - b;
}


module.exports = {
    addressToNumber: addressToNumber,
    aton: addressToNumber,
    bitsToNetmask: bitsToNetmask,
    compareTo: compareTo,
    ipAddrMinus: ipAddrMinus,
    ipAddrPlus: ipAddrPlus,
    isRFC1918: isRFC1918,
    netmaskToBits: netmaskToBits,
    numberToAddress: numberToAddress,
    ntoa: numberToAddress,
    toIPAddr: toIPAddr,
    toIP6Addr: toIP6Addr
};
