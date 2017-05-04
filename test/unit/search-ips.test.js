/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for /search/ips endpoints
 */

'use strict';

var constants = require('../../lib/util/constants');
var fmt = require('util').format;
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_ip = require('../lib/ip');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nicTag = require('../lib/nic-tag');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var test = require('tape');



// --- Globals



var RESERVED_IPV4;
var RESERVED_IPV6;
var NAPI;
var NETS = [];
var NOT_IN_MORAY_IPV4;
var NOT_IN_MORAY_IPV6;



// --- Internal helpers



/**
 * Sorts an array of objects by network uuid
 */
function uuidSort(a, b) {
    return (a.network_uuid > b.network_uuid) ? 1 : -1;
}



// --- Setup



test('Initial setup', function (t) {
    h.reset();

    var net1num    = h.NET_NUM;
    var net1Params = h.validNetworkParams();
    var net2Params = h.validNetworkParams();
    var net3num    = h.NET_NUM;
    var net3Params = h.validNetworkParams();
    var net4num    = h.NET_NUM;
    var net4Params = h.validIPv6NetworkParams();
    var net5num    = h.NET_NUM;
    var net5Params = h.validIPv6NetworkParams();

    RESERVED_IPV4 = fmt('10.0.%d.15', net1num);
    NOT_IN_MORAY_IPV4 = fmt('10.0.%d.19', net3num);

    RESERVED_IPV6 = fmt('fd00:%d::1234', net4num);
    NOT_IN_MORAY_IPV6 = fmt('fd00:%d::1235', net5num);

    function createNet(params, t2) {
        mod_net.create(t2, {
            params: params,
            partialExp: params
        }, function (err, res) {
            t2.ifError(err, 'creating network should succeed');
            if (res) {
                NETS.push(res);
                t2.ok(res.uuid, 'network uuid: ' + res.uuid);
            }

            return t2.end();
        });
    }

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res) {
            t2.ifError(err, 'creating client and server should succeed');
            t2.ok(res, 'client');
            NAPI = res;
            return t2.end();
        });
    });

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, { name: net1Params.nic_tag });
    });

    t.test('create NETS[0]', function (t2) {
        createNet(net1Params, t2);
    });

    t.test('create NETS[1]', function (t2) {
        createNet(net2Params, t2);
    });

    t.test('create NETS[2]', function (t2) {
        createNet(net3Params, t2);
    });

    t.test('create NETS[3]', function (t2) {
        createNet(net4Params, t2);
    });

    t.test('create NETS[4]', function (t2) {
        createNet(net5Params, t2);
    });

    t.test('reserve IPv4', function (t2) {
        NAPI.updateIP(NETS[0].uuid, RESERVED_IPV4, { reserved: true },
            function (err) {
            h.ifErr(t2, err, 'reserve IP');
            t2.end();
        });
    });

    t.test('reserve IPv6', function (t2) {
        NAPI.updateIP(NETS[3].uuid, RESERVED_IPV6, { reserved: true },
            function (err) {
            h.ifErr(t2, err, 'reserve IP');
            t2.end();
        });
    });
});



// --- Tests



test('provisioned nic', function (t) {
    var params = {
        belongs_to_uuid: mod_uuid.v4(),
        belongs_to_type: 'zone',
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic(NETS[2].uuid, params, function (err, nic) {
        if (h.ifErr(t, err, 'provision')) {
            t.end();
            return;
        }

        NAPI.searchIPs(nic.ip, function (err2, res2) {
            if (h.ifErr(t, err2, 'search')) {
                t.end();
                return;
            }

            t.deepEqual(res2, [
                {
                    belongs_to_type: params.belongs_to_type,
                    belongs_to_uuid: params.belongs_to_uuid,
                    free: false,
                    ip: nic.ip,
                    network_uuid: NETS[2].uuid,
                    owner_uuid: params.owner_uuid,
                    reserved: false
                }
            ], 'response');

            t.end();
        });
    });
});


test('IPv4 in moray', function (t) {
    NAPI.searchIPs(RESERVED_IPV4, function (err, obj, req, res) {
        if (h.ifErr(t, err, 'search')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj.sort(uuidSort), [
            {
                free: false,
                ip: RESERVED_IPV4,
                reserved: true,
                network_uuid: NETS[0].uuid
            }
        ]);

        t.end();
    });
});


test('IPv4 not in moray', function (t) {
    NAPI.searchIPs(NOT_IN_MORAY_IPV4, function (err, obj, req, res) {
        if (h.ifErr(t, err, 'search')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj.sort(uuidSort), [
            {
                free: true,
                ip: NOT_IN_MORAY_IPV4,
                reserved: false,
                network_uuid: NETS[2].uuid
            }
        ]);

        t.end();
    });
});


test('IPv6 in moray', function (t) {
    NAPI.searchIPs(RESERVED_IPV6, function (err, obj, req, res) {
        if (h.ifErr(t, err, 'search')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj.sort(uuidSort), [
            {
                free: false,
                ip: RESERVED_IPV6,
                reserved: true,
                network_uuid: NETS[3].uuid
            }
        ]);

        t.end();
    });
});


test('IPv6 not in moray', function (t) {
    NAPI.searchIPs(NOT_IN_MORAY_IPV6, function (err, obj, req, res) {
        if (h.ifErr(t, err, 'search')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj.sort(uuidSort), [
            {
                free: true,
                ip: NOT_IN_MORAY_IPV6,
                reserved: false,
                network_uuid: NETS[4].uuid
            }
        ]);

        t.end();
    });
});


test('Invalid IP', function (t) {
    NAPI.searchIPs('asdf', function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('ip', constants.INVALID_IP_MSG)
            ]
        }), 'Error body');

        t.end();
    });
});


test('IPv4 not in any networks', function (t) {
    NAPI.searchIPs('1.2.3.4', function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: constants.msg.SEARCH_NO_NETS
        }, 'Error body');

        return t.end();
    });
});


test('IPv6 not in any networks', function (t) {
    NAPI.searchIPs('fc00::20', function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: constants.msg.SEARCH_NO_NETS
        }, 'Error body');

        t.end();
    });
});


test('Search', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    var ipObj = {};

    h.copyParams(params, ipObj);

    ipObj.reserved = false;
    ipObj.free = false;

    t.test('create ip', function (t2) {
        mod_nic.provision(t2, {
            net: NETS[2].uuid,
            params: params,
            partialExp: params,
            fillInMissing: true
        }, function (_, res) {
            ipObj.network_uuid = res.network_uuid;
            ipObj.ip = res.ip;
            t2.end();
        });
    });

    t.test('find - just ip', function (t2) {
        mod_ip.search(t2, {
            ip: ipObj.ip,
            params: {},
            present: [ ipObj ]
        });
    });

    t.test('find - ip & belongs_to_uuid', function (t2) {
        mod_ip.search(t2, {
            ip: ipObj.ip,
            params: {
                belongs_to_uuid: ipObj.belongs_to_uuid
            },
            present: [ ipObj ]
        });
    });

    t.test('find - ip & belongs_to_uuid doesn\'t match', function (t2) {
        mod_ip.search(t2, {
            ip: ipObj.ip,
            params: {
                belongs_to_uuid: mod_uuid.v4()
            },
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: constants.msg.SEARCH_NO_NETS
            }
        });
    });
});


// --- Teardown



test('Stop server', mod_server.close);
