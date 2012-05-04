/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * IP-related utilities
 */

var net = require('net');



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



module.exports = {
  addressToNumber: addressToNumber,
  numberToAddress: numberToAddress
};
