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
var autoalloc = require('./autoalloc');
var mod_stream = require('stream');
var util = require('util');

function SubnetPairStream() {
    this.sp_npushed = 0;
    this.sp_prev = null;

    mod_stream.Transform.call(this, { objectMode: true });
}

util.inherits(SubnetPairStream, mod_stream.Transform);

SubnetPairStream.prototype.pushToStream = function (elem) {
    var self = this;
    self.push(elem);
    self.sp_npushed++;
};

/*
 * We receive a stream of subnets as input and produce a stream of subnet-pairs
 * as output. The pairs constitute a sliding window of two subnets.
 */
SubnetPairStream.prototype._transform = function (net, _enc, done) {
    var self = this;
    var sub = net.subnet;
    if (self.sp_prev !== null) {
        self.pushToStream([self.sp_prev, sub]);
    }
    self.sp_prev = sub;
    done();
};


SubnetPairStream.prototype._flush = function (done) {
    var self = this;
    if (self.sp_npushed === 0 && self.sp_prev !== null) {
        self.pushToStream([self.sp_prev]);
    }
    done();
};

/*
 * A stream of available subnets. It finds gaps in between existing subnets,
 * and for each gap, fetches only up to the first 16 available subnets (i.e.
 * less than 16, if the gap is really small). If we find no gaps (or eventually
 * run out), it will get available subnets that are 1) less than the first seen
 * subnet, and 2) greater than the last seen subnet, in that order.
 */
function AvailableSubnetStream(opts) {
    this.us_opts = opts;
    this.us_npushed = 0;
    this.us_firstSeen = null;
    this.us_lastSeen = null;
    this.us_prevPair = null;

    mod_stream.Transform.call(this, { objectMode: true });
}

util.inherits(AvailableSubnetStream, mod_stream.Transform);

AvailableSubnetStream.prototype.pushToStream = function (elem) {
    var self = this;
    self.push(elem);
    self.us_npushed++;
};

/*
 * We receive a stream of subnet-pairs as input, and produce a stream of
 * available subnets as output. The available subnets all fit the user's
 * specifications (prefix length).
 */
AvailableSubnetStream.prototype._transform = function (pair, _enc, done) {
    assert.ok(pair.length <= 2);
    assert.ok(pair.length > 0);
    var self = this;
    var startSub = pair[0];
    var endSub = pair.length > 1 ? pair[1] : pair[0];
    var newSubLimit = 16;
    var plen = self.us_opts.params.subnet_prefix;
    var i = 0;
    var currentSub = startSub;
    self.us_prevPair = pair;

    if (self.us_firstSeen === null) {
        self.us_firstSeen = pair[0];
    }
    self.us_lastSeen = pair[(pair.length - 1)];

    if (pair.length === 1 ||
        autoalloc.haveGapBetweenSubnets(pair[0], pair[1])) {
        while (i < newSubLimit) {
            currentSub = autoalloc.incrementSubnet(currentSub, plen);
            if (currentSub === null ||
                currentSub.compare(endSub) === 0) {
                break;
            }
            self.pushToStream(currentSub);
            i++;
        }
    }
    done();
};


AvailableSubnetStream.prototype._flush = function (done) {
    var self = this;
    var plen = self.us_opts.params.subnet_prefix;
    var startSub = self.us_firstSeen;
    var currentSub = null;
    var endSub = self.us_lastSeen;
    var newSubLimit = 16;
    var i = 0;
    /* There were no used subnets */
    if (self.us_prevPair === null) {
        while (i < newSubLimit) {
            if (currentSub === null) {
                currentSub = ipaddr.createCIDR('10.0.0.0', plen);
            } else {
                currentSub = autoalloc.incrementSubnet(currentSub, plen);
            }
            if (currentSub === null) {
                break;
            }
            self.pushToStream(currentSub);
            i++;
        }
        done();
        return;
    }

    /*
     * There were used subnets, but we have pushed less than 16 subnets to the
     * stream.
     */
    currentSub = autoalloc.decrementSubnet(startSub, plen);
    while (currentSub && self.us_npushed < newSubLimit) {
        self.pushToStream(currentSub);
        currentSub = autoalloc.decrementSubnet(currentSub, plen);
    }

    if (self.us_npushed >= newSubLimit) {
        done();
        return;
    }

    currentSub = autoalloc.incrementSubnet(endSub, plen);
    while (currentSub && self.us_npushed < newSubLimit) {
        self.pushToStream(currentSub);
        currentSub = autoalloc.incrementSubnet(currentSub, plen);
    }

    done();
};

module.exports = {
    SubnetPairStream: SubnetPairStream,
    AvailableSubnetStream: AvailableSubnetStream
};
