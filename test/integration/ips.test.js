/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for /networks/:uuid/ips endpoints
 */

'use strict';

var common = require('../lib/common');
var h = require('./helpers');
var mod_ip = require('../lib/ip');
var mod_net = require('../lib/net');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var IPS = {
    start: '10.1.1.5',
    reserved: '10.1.1.20',
    free: '10.1.1.57',
    zone: '10.1.1.59',
    end: '10.1.1.250',
    broadcast: '10.1.1.255'
};
var napi = h.createNAPIclient();
var state = {};
var uuids = {
    admin: '',  // set in setup below
    a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2'
};



// --- Setup



test('setup', function (t) {
    t.test('load UFDS admin UUID', function (t2) {
        h.loadUFDSadminUUID(t2, function (adminUUID) {
            if (adminUUID) {
                uuids.admin = adminUUID;
            }

            return t2.end();
        });
    });


    t.test('create test nic tag', function (t2) {
        h.createNicTag(t2, napi, state);
    });


    t.test('create test network', function (t2) {
        var net = h.validNetworkParams({
            subnet: '10.1.1.0/24',
            provision_start_ip: IPS.start,
            provision_end_ip: IPS.end
        });

        mod_net.create(t2, {
            fillInMissing: true,
            params: net,
            exp: net,
            state: state
        });
    });
});



// --- Tests



test('get test network', function (t) {
    napi.getNetwork(state.networks[0].uuid, function (err, res) {
        if (h.ifErr(t, err, 'get network ' + state.networks[0].uuid)) {
            return t.end();
        }

        t.equal(res.provision_start_ip, IPS.start, 'start IP');
        t.equal(res.provision_end_ip, IPS.end, 'end IP');
        t.equal(res.subnet, state.networks[0].subnet, 'subnet');

        return t.end();
    });
});


test('GET /networks/:uuid/ips/:ip (free IP)', function (t) {
    napi.getIP(state.networks[0].uuid, IPS.free, function (err, res) {
        var desc = util.format(' %s/%s', state.networks[0].uuid, IPS.free);
        t.ifError(err, 'getting IP' + desc);
        var exp = {
            free: true,
            ip: IPS.free,
            network_uuid: state.networks[0].uuid,
            reserved: false
        };
        t.deepEqual(res, exp, 'GET free IP' + desc);

        napi.searchIPs(IPS.free, function (err2, res2) {
            if (h.ifErr(t, err2, 'search for free IP' + desc)) {
                return t.end();
            }

            t.deepEqual(res2, [ exp ], 'search response');

            return t.end();
        });
    });
});


test('PUT /networks/:uuid/ips/:ip', function (t) {
    var params = {
        reserved: true,
        owner_uuid: uuids.admin,
        belongs_to_type: 'zone',
        belongs_to_uuid: uuids.a
    };

    napi.updateIP(state.networks[0].uuid, IPS.zone, params,
        function (err, res) {
        if (err) {
            return h.doneWithError(err, 'updating IP: ' + IPS.zone);
        }

        params.ip = IPS.zone;
        params.free = false;
        params.network_uuid = state.networks[0].uuid;
        state.ip = params;
        t.deepEqual(res, params, 'reserving an IP');

        return napi.getIP(state.networks[0].uuid, params.ip,
                function (err2, res2) {
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, params, 'GET on a reserved IP');

            return t.end();
        });
    });
});


test('GET /networks/:uuid/ips', function (t) {
    var broadcastIP = {
        belongs_to_type: 'other',
        belongs_to_uuid: uuids.admin,
        free: false,
        ip: IPS.broadcast,
        network_uuid: state.networks[0].uuid,
        owner_uuid: uuids.admin,
        reserved: true
    };

    var before = {
        free: true,
        ip: '10.1.1.4',
        network_uuid: state.networks[0].uuid,
        reserved: false
    };

    var after = {
        free: true,
        ip: '10.1.1.251',
        network_uuid: state.networks[0].uuid,
        reserved: false
    };

    mod_ip.list(t, {
        deepEqual: true,
        net: state.networks[0].uuid,
        present: [ before, state.ip, after, broadcastIP ]
    });
});


test('PUT /networks/:uuid/ips/:ip (free an IP)', function (t) {
    var doUpdate = function (_, cb) {
        var params = {
            free: true
        };

        napi.updateIP(state.networks[0].uuid, IPS.zone, params,
            function (err, res) {
            if (err) {
                return h.doneWithError(t, err, 'freeing IP: ' + IPS.zone);
            }

            params.ip = IPS.zone;
            params.free = true;
            params.reserved = false;
            params.network_uuid = state.networks[0].uuid;
            t.deepEqual(res, params, 'freeing an IP');

            return napi.getIP(state.networks[0].uuid, params.ip,
                    common.reqOpts(t), function (err2, res2) {
                t.ifError(err2, 'getting free IP: ' + IPS.zone);
                if (err2) {
                    return cb(err2);
                }

                t.deepEqual(res2, params, 'GET on a free IP');
                return cb();
            });
        });
    };

    // Try this twice, to prove that it works for both a free and a non-free IP
    vasync.pipeline({
        funcs: [
            doUpdate,
            doUpdate
        ]
    }, function (err) {
        t.ifError(err, 'both updates should succeed');
        t.end();
    });
});


test('GET /networks/:uuid/ips: reserved IP', function (t) {
    var params = {
        reserved: true
    };

    napi.updateIP(state.networks[0].uuid, IPS.reserved, params,
        function (err, res) {
        if (err) {
            return h.doneWithError(err, 'updating IP: ' + IPS.reserved);
        }

        params.ip = IPS.reserved;
        params.free = false;
        params.network_uuid = state.networks[0].uuid;
        t.deepEqual(res, params, 'reserving IP: ' + IPS.reserved);

        return napi.listIPs(state.networks[0].uuid, function (err2, ips) {
            if (h.ifErr(t, err2, 'listing IPs')) {
                return t.end();
            }

            var found = false;
            for (var i in ips) {
                if (ips[i].ip === params.ip) {
                    found = true;
                    t.deepEqual(ips[i], params, 'IP in list is correct');
                    break;
                }
            }

            t.ok(found, 'found IP in list');
            return t.end();
        });
    });
});

// XXX: tests to add:
// * exhaust a subnet test:
//   * create a /28
//   * provision all IPs on it - verify we get them in order
//   * verify out of IPs error
//   * unassign 3 IPs, but reserve one of them
//   * provision 3 more times: should only get the 2 unreserved IPs, plus
//     an out of IPs error
// * same as above, but provision with an IP in the middle of the range
//   first



// --- Teardown



test('teardown', function (t) {
    t.test('delete network', mod_net.delAllCreated);

    t.test('remove test nic tag', function (t2) {
        h.deleteNicTag(t2, napi, state);
    });
});
