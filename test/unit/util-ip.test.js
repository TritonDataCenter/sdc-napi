/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * IP address utility unit tests
 */


var IP = require('../../lib/util/ip');
var test = require('tap').test;
var util = require('util');


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
  t.end();
});


test('addressToNumber - invalid', function (t) {
  var ips = ['1.2.3.4.5', 'asdf', null, '256.0.0.1', '1.2.3.300', '1.2'];
  for (var i in ips) {
    t.equal(IP.addressToNumber(ips[i]), null,
      util.format('IP "%s" is invalid', ips[i]));
  }
  t.end();
});


test('bitsToNetmask / netmaskToBits', function (t) {
  var bits = {
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
  t.end();
});
