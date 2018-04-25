/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * IP address utility unit tests
 */

'use strict';

var ip6addr = require('ip6addr');
var IP = require('../../lib/util/ip');
var test = require('tape');
var util = require('util');

var s = ip6addr.createCIDR;


test('addressToNumber / numberToAddress - valid', function (t) {
    var ips = {
        '1.2.3.4': 16909060,
        '0.0.0.0': 0,
        '255.255.255.255': 4294967295,
        '10.88.88.1': 173561857,
        '10.88.88.255': 173562111,
        '10.88.88.0': 173561856
    };
    for (var i in ips) {
        t.equal(IP.addressToNumber(i), ips[i],
            util.format('IP address "%s" converts correctly', i));
        t.equal(IP.numberToAddress(ips[i]), i,
            util.format('IP number "%d" converts correctly', ips[i]));
    }

    return t.end();
});



test('addressToNumber - invalid', function (t) {
    var ips = ['1.2.3.4.5', 'asdf', null, '256.0.0.1', '1.2.3.300', '1.2'];
    for (var i in ips) {
        t.equal(IP.addressToNumber(ips[i]), null,
            util.format('IP "%s" is invalid', ips[i]));
    }

    return t.end();
});



test('bitsToNetmask / netmaskToBits', function (t) {
    var bits = {
        '0': '0.0.0.0',
        '1': '128.0.0.0',
        '2': '192.0.0.0',
        '8': '255.0.0.0',
        '16': '255.255.0.0',
        '24': '255.255.255.0',
        '25': '255.255.255.128',
        '32': '255.255.255.255'
    };
    for (var b in bits) {
        t.equal(IP.bitsToNetmask(b), bits[b],
            util.format('bit count %d is valid', b));
        t.equal(IP.netmaskToBits(bits[b]), Number(b),
            util.format('netmask %s is valid', bits[b]));
    }

    return t.end();
});



test('toIPAddr - valid', function (t) {
    var ips = [
        ['1.2.3.4', '1.2.3.4'],
        ['0.0.0.0', '0.0.0.0'],
        ['255.255.255.255', '255.255.255.255'],
        ['10.88.88.1', '10.88.88.1'],
        ['10.88.88.255', '10.88.88.255'],
        ['10.88.88.0', '10.88.88.0'],
        ['16909060', '1.2.3.4'],
        ['0', '0.0.0.0'],
        ['4294967295', '255.255.255.255'],
        ['173561857', '10.88.88.1'],
        ['173562111', '10.88.88.255'],
        ['173561856', '10.88.88.0'],
        [16909060, '1.2.3.4'],
        [0, '0.0.0.0'],
        [4294967295, '255.255.255.255'],
        [173561857, '10.88.88.1'],
        [173562111, '10.88.88.255'],
        [173561856, '10.88.88.0'],
        ['fe80:0000:0000:0000:0202:b3ff:fe1e:8329', 'fe80::202:b3ff:fe1e:8329'],
        ['fe80::0202:b3ff:fe1e:8329', 'fe80::202:b3ff:fe1e:8329']
    ];

    ips.forEach(function (ip) {
        var input = ip[0];
        var expected = ip[1];
        var ipobj = IP.toIPAddr(input);
        t.equal(ipobj.toString(), expected,
            util.format('IP address "%s" converts correctly', input));
        t.equal(ipobj, IP.toIPAddr(ipobj), 'idempotent');
    });

    return t.end();
});



test('toIPAddr - invalid', function (t) {
    var ips = [
        '1.2.3.4.5',
        'asdf',
        null,
        '256.0.0.1',
        '1.2.3.300',
        '1.2',
        '-1',
        -1,
        Math.pow(2, 32),
        Math.pow(2, 40),
        Math.pow(2, 32).toString(),
        Math.pow(2, 40).toString(),
        'A:B:C',
        'FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF:FFFF'
    ];

    ips.forEach(function (ip) {
        t.equal(IP.toIPAddr(ip), null,
            util.format('IP "%s" is invalid', ip));
    });

    return t.end();
});



test('ipAddrPlus / ipAddrMinus', function (t) {
    var ips = [
        ['0.0.0.0', 1, '0.0.0.1'],
        ['0.0.3.255', 1, '0.0.4.0'],
        ['0.2.255.255', 1, '0.3.0.0'],
        ['1.255.255.255', 1, '2.0.0.0'],
        ['0.0.0.0', 256, '0.0.1.0'],
        ['0.255.255.255', 4278190080, '255.255.255.255'],
        ['2001:db8::1', 1, '2001:db8::2'],
        ['2001:db8::1', 0xFFFF, '2001:db8::1:0'],
        ['2001:db8::1', 0xFFFF + 1, '2001:db8::1:1']
    ];

    ips.forEach(function (terms) {
        var a = IP.toIPAddr(terms[0]);
        var b = IP.toIPAddr(terms[2]);
        t.ok(a, terms[0]);
        t.ok(b, terms[2]);
        var scalar = terms[1];
        var sum = IP.ipAddrPlus(a, scalar);
        var difference = IP.ipAddrMinus(b, scalar);
        t.equal(sum.toString(), b.toString(),
            util.format('%s + %d = %s', a.toString(), scalar, b.toString()));
        t.equal(difference.toString(), a.toString(),
            util.format('%s - %d = %s', b.toString(), scalar, a.toString()));
    });

    return t.end();
});



test('ipAddrPlus / ipAddrMinus - overflow, underflow', function (t) {
    var largeOffsets = [
        ['0.0.0.0', 4294967296],
        ['0.0.0.0', -4294967296],
        ['255.255.255.255', 4294967296],
        ['255.255.255.255', -4294967296]
    ];

    largeOffsets.forEach(function (terms) {
        var ip = IP.toIPAddr(terms[0]);
        var scalar = terms[1];
        t.throws(function () {
            IP.ipAddrPlus(ip, scalar);
        }, /offsets should be between -4294967295 and 4294967295/,
        util.format('%s + %d overflows', ip, scalar));
    });

    var over = [
        ['255.255.255.255', 1],
        ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 1]
    ];

    over.forEach(function (terms) {
        var ip = IP.toIPAddr(terms[0]);
        var scalar = terms[1];
        t.throws(function () {
            IP.ipAddrPlus(ip, scalar);
        }, /overflow!/, util.format('%s + %d overflows', ip, scalar));
    });

    var under = [
        ['0.0.0.0', 1],
        ['::0', 1]
    ];

    under.forEach(function (terms) {
        var ip = IP.toIPAddr(terms[0]);
        var scalar = terms[1];
        t.throws(function () {
            IP.ipAddrMinus(ip, scalar);
        }, /underflow!/, util.format('%s - %d underflows', ip, scalar));
    });

    return t.end();
});



test('compareTo', function (t) {
    function gt(a, b) {
        t.ok(IP.compareTo(IP.toIPAddr(a), IP.toIPAddr(b)) > 0,
            util.format('compareTo: %s > %s', a.toString(), b.toString()));
    }

    function lt(a, b) {
        t.ok(IP.compareTo(IP.toIPAddr(a), IP.toIPAddr(b)) < 0,
            util.format('compareTo: %s < %s', a.toString(), b.toString()));
    }

    function eq(a, b) {
        t.ok(IP.compareTo(IP.toIPAddr(a), IP.toIPAddr(b)) === 0,
            util.format('compareTo: %s === %s', a.toString(), b.toString()));
    }

    var ips = [
        ['0.0.0.0', '0.0.0.1'],
        ['0.0.3.255', '0.0.4.0'],
        ['0.2.255.255', '0.3.0.0'],
        ['1.255.255.255', '2.0.0.0'],
        ['0.0.0.0', '0.0.1.0'],
        ['0.255.255.255', '255.255.255.255'],
        ['2001:db8::1', '2001:db8::2'],
        ['2001:db8::1', '2001:db8::1:0'],
        ['2001:db8::1', '2001:db8::1:1'],
        ['0.0.0.0', '2001:db8::1']
    ];


    ips.forEach(function (pair) {
        lt(pair[0], pair[1]);
        gt(pair[1], pair[0]);
    });

    var equal = [
        ['0.0.0.0', '0.0.0.0'],
        ['::ffff:a58:5801', '10.88.88.1'],
        ['2001:db8::1', '2001:db8:0::1']
    ];

    equal.forEach(function (pair) {
        eq(pair[0], pair[1]);
        eq(pair[1], pair[0]);
    });

    return t.end();
});


test('isRFC1918', function (t) {
    var valid = [
        s('10.0.0.0/8'),
        s('10.3.2.0/24'),
        s('10.255.255.0/24'),
        s('10.255.255.255/32'),
        s('172.16.0.0/16'),
        s('172.16.0.0/12'),
        s('172.17.17.17/32'),
        s('172.31.255.255/32'),
        s('192.168.0.0/16'),
        s('192.168.0.0/24'),
        s('192.168.20.20/32'),
        s('192.168.255.255/32')
    ];

    t.test('valid', function (t2) {
        for (var v in valid) {
            var val = valid[v];
            t2.ok(IP.isRFC1918(val), val + ' valid');
        }

        return t2.end();
    });


    var invalid = [
        s('fc00:5de::/64'),
        s('fd00::1/128'),
        s('fd05:a:b:c::167/128'),
        s('9.255.255.255/32'),
        s('11.0.0.0/8'),
        s('172.15.255.0/24'),
        s('172.32.0.0/16'),
        s('192.167.255.0/24'),
        s('192.168.0.0/15'),
        s('192.169.0.0/16'),
        s('8.8.8.8/32')
    ];

    t.test('invalid', function (t2) {
        for (var v in invalid) {
            var val = invalid[v];
            t2.ok(!IP.isRFC1918(val), val + ' invalid');
        }

        return t2.end();
    });
});

test('isUniqueLocal', function (t) {
    var valid = [
        s('fd00::/8'),
        s('fd00::/16'),
        s('fd00::/64'),
        s('fd05:a:b:c::167/128'),
        s('fd34::20e:0/112'),
        s('fd5e::1f/128'),
        s('fddd::40e/128')
    ];

    t.test('valid', function (t2) {
        for (var v in valid) {
            var val = valid[v];
            t2.ok(IP.isUniqueLocal(val), val + ' valid');
        }

        t2.end();
    });


    var invalid = [
        // Invalid for now, since fc00::/8 is unallocated:
        s('fc00::/7'),
        s('fc00::/8'),
        s('fc00:5de::243/128'),
        s('fc02::a:b:c:d/128'),
        s('fcff::20/128'),

        // Always invalid:
        s('2001:4860:4860::8888/128'),
        s('fe00::/16'),
        s('fe00::/64'),
        s('fb00::20/128'),
        s('a:b:c:d::/64'),
        s('123:456:789:0:0:987:654:321/128'),
        s('fe80::92b8:d0ff:fe4b:c73b/128'),
        s('::/0'),
        s('::1/128'),
        s('1.2.3.4/32'),
        s('10.10.10.5/32'),
        s('192.168.1.1/32')
    ];

    t.test('invalid', function (t2) {
        for (var v in invalid) {
            var val = invalid[v];
            t2.ok(!IP.isUniqueLocal(val), val + ' invalid');
        }

        t2.end();
    });
});
