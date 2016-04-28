/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * MAC address utility unit tests
 */

'use strict';

var MAC = require('../../lib/util/mac');
var test = require('tape');


test('macOUItoNumber - valid', function (t) {
    var macs = [
        ['90b8d0', 159123438043136, '90:b8:d0:00:00:00'],
        ['ffffff', 281474959933440, 'ff:ff:ff:00:00:00']
    ];

    for (var m in macs) {
        t.equal(MAC.macOUItoNumber(macs[m][0]), macs[m][1],
            'MAC number for "' + macs[m][0] + '" is valid');
        t.equal(MAC.macNumberToAddress(macs[m][1]), macs[m][2],
            'MAC address "' + macs[m][2] + '" is valid');
    }

    return t.end();
});


test('macNumberToAddress - valid', function (t) {
    var macs = {
        '281474976710655': 'ff:ff:ff:ff:ff:ff',
        '345052807169': '00:50:56:c0:00:01',
        '2233935667156': '02:08:20:f1:1f:d4',
        '45459793942': '00:0a:95:9d:68:16',
        '6805088278': '00:01:95:9d:68:16'
    };

    for (var m in macs) {
        t.equal(MAC.macNumberToAddress(m), macs[m],
            'MAC address "' + macs[m] + '" is valid');
        t.equal(MAC.macAddressToNumber(macs[m]), Number(m),
            'MAC number "' + m + '" is valid');
        t.equal(MAC.macAddressToNumber(macs[m].replace(/:/g, '')), Number(m),
            'MAC number "' + m + '" is valid (without colons)');
        t.equal(MAC.macAddressToNumber(macs[m].replace(/:/g, '-')), Number(m),
            'MAC number "' + m + '" is valid (with dashes)');
    }

    return t.end();
});


test('macAddressToNumber - invalid', function (t) {
    var macs = [
        'asdf', 'ff:ff:ff:ff:ff:fg', 'ff:ff:ff:ff:ff:ff1',
        'ff:ff:ff:ff:ff:ff:11'
    ];

    for (var m in macs) {
        t.equal(MAC.macAddressToNumber(macs[m]), null,
            'MAC address "' + macs[m] + '" is invalid');
    }

    return t.end();
});
