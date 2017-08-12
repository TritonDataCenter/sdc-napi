/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

/*
 * OUI/MAC address utility unit tests
 */

'use strict';

var util_oui = require('../../lib/util/oui');
var test = require('tape');

var OUIS = [
    [ '000000', 0, 16777215 ],
    [ '005056', 345040224256, 345057001471 ],
    [ '90b8d0', 159123438043136, 159123454820351 ],
    [ 'ffffff', 281474959933440, 281474976710655 ]
];

test('macOUItoNumber - valid', function (t) {
    OUIS.forEach(function (ex) {
        t.equal(util_oui.macOUItoNumber(ex[0]), ex[1],
            'MAC number for "' + ex[0] + '" is valid');
    });

    t.end();
});


test('maxOUInum - valid', function (t) {
    OUIS.forEach(function (ex) {
        t.equal(util_oui.maxOUInum(ex[0]), ex[2],
            'Max MAC value for "' + ex[0] + '" is valid');
    });

    t.end();
});


test('randomNum - valid', function (t) {
    var seen = {};

    function generateNumber(ex) {
        var random = util_oui.randomNum(ex[0]);
        t.ok(random >= ex[1] && random <= ex[2],
            'Random MAC value for OUI "' + ex[0] +
            '" is within bounds (generated ' + random + ')');
        t.ok(!seen.hasOwnProperty(random), 'Number is unique');
        seen[random] = 1;
    }

    OUIS.forEach(function (ex) {
        for (var i = 0; i < 10; i++) {
            generateNumber(ex);
        }
    });

    t.end();
});
