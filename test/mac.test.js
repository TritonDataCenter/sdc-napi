/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the MAC address utility functions */

var test = require('tap').test;
var MAC = require('../lib/util/mac');


test('macOUItoNumber - valid', function (t) {
  var macs = [
    ['90b8d0', 159123438043136, '90:b8:d0:00:00:00'],
    ['ffffff', 281474959933440, 'ff:ff:ff:00:00:00']
  ];
  for (var m in macs) {
    t.equal(MAC.macOUItoNumber(macs[m][0]), macs[m][1],
      'MAC number for "' + macs[m][0] + '" is valid');
    t.equal(MAC.macNumberToAddress(macs[m][1]), macs[m][2],
      'MAC address "' +macs[m][2] + '" is valid');
  }
  t.end();
});


test('macNumberToAddress - valid', function (t) {
  var macs = {
    '281474976710655': 'ff:ff:ff:ff:ff:ff',
    '345052807169': '00:50:56:c0:00:01',
    '2233935667156': '02:08:20:f1:1f:d4'
  };
  for (var m in macs) {
    t.equal(MAC.macNumberToAddress(m), macs[m],
      'MAC address "' + macs[m] + '" is valid');
    t.equal(MAC.macAddressToNumber(macs[m]), Number(m),
      'MAC number "' + m + '" is valid');
    t.equal(MAC.macAddressToNumber(macs[m].replace(/:/g, '-')), Number(m),
      'MAC number "' + m + '" is valid (with dashes)');
  }
  t.end();
});


test('macAddressToNumber - invalid', function (t) {
  var macs = [
    'asdf', 'ff:ff:ff:ff:ff:fg', 'ff:ff:ff:ff:ff:ff1', 'ff:ff:ff:ff:ff:ff:11'
  ];

  for (var m in macs) {
    t.equal(MAC.macAddressToNumber(macs[m]), null,
      'MAC address "' + macs[m] + '" is invalid');
  }
  t.end();
});
