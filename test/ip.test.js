/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 */

/* Test the IP address utility functions */

var test = require('tap').test;
var IP = require('../lib/util/ip');


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
    t.equal(IP.addressToNumber(i), ips[i], 'IP number "' + i + '" is valid');
    t.equal(IP.numberToAddress(ips[i]), i, 'IP address "' + i + '" is valid');
  }
  t.end();
});


test('addressToNumber - invalid', function (t) {
  var ips = ['1.2.3.4.5', 'asdf', null, '256.0.0.1', '1.2.3.300', '1.2'];
  for (var i in ips) {
    t.equal(IP.addressToNumber(ips[i]), null, 'IP "' + ips[i] + '" is invalid');
  }
  t.end();
});
