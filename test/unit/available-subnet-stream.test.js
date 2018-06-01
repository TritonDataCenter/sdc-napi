
/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018, Joyent, Inc.
 */

/*
 * Unit tests for unknown subnet stream.
 */

'use strict';

var mod_subnet_streams = require('../../lib/util/subnet-streams');
var test = require('tape');

var SubnetPairStream = mod_subnet_streams.SubnetPairStream;
var AvailableSubnetStream = mod_subnet_streams.AvailableSubnetStream;
var ipaddr = require('ip6addr');

function c(s) {
    return (ipaddr.createCIDR(s));
}

function driver(t, input_pairs, outputs) {
    t.test('Verify Inputs and Ouputs', function (t2) {
        var pairStream = new SubnetPairStream();
        var streamOpts = {params: {subnet_prefix: 24}};
        var availableSubnetsStream = new AvailableSubnetStream(streamOpts);
        var pipeline = pairStream.pipe(availableSubnetsStream);
        var output_num = 0;
        var areDone = false;
        function done() {
            if (areDone === true) {
                return;
            }
            areDone = true;
            pipeline.removeListener('readable', onReadable);
            pipeline.removeListener('error', onError);
            pipeline.removeListener('end', onEnd);
            t2.end();
        }
        function onError(err2) {
            t2.ok(false);
            done(err2);
        }
        function onReadable() {
            for (;;) {
                var out = pipeline.read(1);
                if (out === null || output_num === outputs.length) {
                    t2.ok(output_num === outputs.length);
                    return;
                }
                t2.deepEqual(outputs[output_num], out);
                output_num++;
            }
        }
        function onEnd() {
            done();
        }
        input_pairs.forEach(function (pair) {
            pipeline.write(pair);
        });
        pipeline.end();
        pipeline.on('readable', onReadable);
        pipeline.on('end', onEnd);
        pipeline.on('error', onError);
    });
}


// NOTE:
// We want to create a stream, where we push manually constructed pairs on 1
// side, and verify that the other side emits the subnets that in the gaps.
// Pretty simple, requires:
//    - test for stream input with gaps
//    - test for gapless (non-empty) input stream
//    - test for empty input stream

test('Gapful Test', function (t) {
    var input_pairs = [
        [c('10.0.0.0/24'), c('10.0.1.0/24')],
        [c('10.0.1.0/24'), c('10.2.0.0/24')],
        [c('10.2.0.0/24'), c('10.2.99.0/24')],
        [c('10.2.99.0/24'), c('10.2.100.0/24')],
        [c('10.2.100.0/24'), c('10.2.200.0/24')]
    ];
    var outputs = [
        c('10.0.2.0/24'),
        c('10.0.3.0/24'),
        c('10.0.4.0/24'),
        c('10.0.5.0/24'),
        c('10.0.6.0/24'),
        c('10.0.7.0/24'),
        c('10.0.8.0/24'),
        c('10.0.9.0/24'),
        c('10.0.10.0/24'),
        c('10.0.11.0/24'),
        c('10.0.12.0/24'),
        c('10.0.13.0/24'),
        c('10.0.14.0/24'),
        c('10.0.15.0/24'),
        c('10.0.16.0/24'),
        c('10.0.17.0/24'),
        c('10.2.1.0/24'),
        c('10.2.2.0/24'),
        c('10.2.3.0/24'),
        c('10.2.4.0/24'),
        c('10.2.5.0/24'),
        c('10.2.6.0/24'),
        c('10.2.7.0/24'),
        c('10.2.8.0/24'),
        c('10.2.9.0/24'),
        c('10.2.10.0/24'),
        c('10.2.11.0/24'),
        c('10.2.12.0/24'),
        c('10.2.13.0/24'),
        c('10.2.14.0/24'),
        c('10.2.15.0/24'),
        c('10.2.16.0/24'),
        c('10.2.101.0/24'),
        c('10.2.102.0/24'),
        c('10.2.103.0/24'),
        c('10.2.104.0/24'),
        c('10.2.105.0/24'),
        c('10.2.106.0/24'),
        c('10.2.107.0/24'),
        c('10.2.108.0/24'),
        c('10.2.109.0/24'),
        c('10.2.110.0/24'),
        c('10.2.111.0/24'),
        c('10.2.112.0/24'),
        c('10.2.113.0/24'),
        c('10.2.114.0/24'),
        c('10.2.115.0/24'),
        c('10.2.116.0/24')
    ];
    driver(t, input_pairs, outputs);
    t.end();
});

test('Gapless Test', function (t) {
    var input_pairs = [
        [c('10.0.1.0/24'), c('10.0.2.0/24')],
        [c('10.0.2.0/24'), c('10.0.3.0/24')],
        [c('10.0.3.0/24'), c('10.0.4.0/24')],
        [c('10.0.4.0/24'), c('10.0.5.0/24')]
    ];
    var outputs = [
        c('10.0.0.0/24'),
        c('10.0.6.0/24'),
        c('10.0.7.0/24'),
        c('10.0.8.0/24'),
        c('10.0.9.0/24'),
        c('10.0.10.0/24'),
        c('10.0.11.0/24'),
        c('10.0.12.0/24'),
        c('10.0.13.0/24'),
        c('10.0.14.0/24'),
        c('10.0.15.0/24'),
        c('10.0.16.0/24'),
        c('10.0.17.0/24'),
        c('10.0.18.0/24'),
        c('10.0.19.0/24'),
        c('10.0.20.0/24')
    ];
    driver(t, input_pairs, outputs);
    t.end();
});

test('Empty Test', function (t) {
    var input_pairs = [];
    var outputs = [
        c('10.0.0.0/24'),
        c('10.0.1.0/24'),
        c('10.0.2.0/24'),
        c('10.0.3.0/24'),
        c('10.0.4.0/24'),
        c('10.0.5.0/24'),
        c('10.0.6.0/24'),
        c('10.0.7.0/24'),
        c('10.0.8.0/24'),
        c('10.0.9.0/24'),
        c('10.0.10.0/24'),
        c('10.0.11.0/24'),
        c('10.0.12.0/24'),
        c('10.0.13.0/24'),
        c('10.0.14.0/24'),
        c('10.0.15.0/24')
    ];
    driver(t, input_pairs, outputs);
    t.end();
});
