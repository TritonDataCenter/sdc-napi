/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * Unit tests for IP endpoints
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../lib/common');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var mod_server = require('../lib/server');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var MORAY_IPV4 = '10.0.2.15';
var NON_MORAY_IPV4 = '10.0.2.115';
var NAPI;
var NETV4;
var INVALID_PARAMS = [
    ['belongs_to_uuid', 'a', 'invalid UUID'],
    ['belongs_to_type', '', 'must not be empty'],
    ['belongs_to_type', '  ', 'must not be empty'],
    ['owner_uuid', 'a', 'invalid UUID'],
    ['reserved', 'a', 'must be a boolean value'],
    ['reserved', '1', 'must be a boolean value']
];
var MULTIPLE_PARAMS_REQ = [
    { belongs_to_uuid: mod_uuid.v4() },
    { belongs_to_type: 'server' },
    { belongs_to_uuid: mod_uuid.v4(), owner_uuid: mod_uuid.v4() },
    { belongs_to_type: 'zone', owner_uuid: mod_uuid.v4() }
];



// --- Setup



test('Initial setup', function (t) {
    t.plan(4);
    var v4netParams = h.validNetworkParams();

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            NAPI = res;

            return t2.end();
        });
    });

    t.test('create nic tag', function (t2) {

        NAPI.createNicTag(v4netParams.nic_tag, function (err) {
            h.ifErr(t2, err, 'create nic tag');
            return t2.end();
        });
    });

    t.test('create v4 network', function (t2) {
        NAPI.createNetwork(v4netParams, function (err, res) {
            h.ifErr(t2, err, 'create network');
            NETV4 = res;

            return t2.end();
        });
    });

    t.test('add IPv4 address to moray', function (t2) {
        NAPI.updateIP(NETV4.uuid, MORAY_IPV4, { reserved: true },
            function (err) {
            h.ifErr(t2, err, 'add IP to moray');

            return t2.end();
        });
    });
});


// --- Get tests



test('Get IPv4 - non-existent network', function (t) {
    NAPI.getIP(mod_uuid.v4(), '1.2.3.4', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.end();
    });
});


test('Get IPv4 - outside subnet', function (t) {
    var invalid = [
        '10.0.3.1',
        '10.0.1.255',
        '8.8.8.8'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.getIP(NETV4.uuid, ip, function (err, res) {
                t.ok(err, 'error returned: ' + ip);
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'IP is not in subnet'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Get IPv6 - subnet has different address family', function (t) {
    var invalid = [
        'fd00::1',
        'fe80::92b8:d0ff:fe4b:c73b',
        '2001:4860:4860::8888'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.getIP(NETV4.uuid, ip, function (err, res) {
                t.ok(err, 'error returned: ' + ip);
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'IP and subnet are of different address families'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Get IP - invalid', function (t) {
    var invalid = [
        'a',
        '10.0.2.256'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.getIP(NETV4.uuid, ip, function (err, res) {
                t.ok(err, 'error returned: ' + ip);
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'Invalid IP address'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Get IPv4 - record not in moray', function (t) {
    NAPI.getIP(NETV4.uuid, NON_MORAY_IPV4, function (err, obj, req, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: NON_MORAY_IPV4,
            network_uuid: NETV4.uuid,
            reserved: false,
            free: true
        }, 'response');

        return t.end();
    });
});


test('Get IPv4 - record in moray', function (t) {
    NAPI.getIP(NETV4.uuid, MORAY_IPV4, function (err, obj, req, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: MORAY_IPV4,
            network_uuid: NETV4.uuid,
            reserved: true,
            free: false
        }, 'response');

        return t.end();
    });
});



// --- Update tests



test('Update IP - invalid network', function (t) {
    NAPI.updateIP('doesnotexist', '1.2.3.4', { reserved: true },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.end();
    });
});


test('Update IP - non-existent network', function (t) {
    NAPI.updateIP(mod_uuid.v4(), '1.2.3.4', { reserved: true },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.end();
    });
});


test('Update IPv4 - outside subnet', function (t) {
    var invalid = [
        '10.0.3.1',
        '10.0.1.255',
        '32',
        '0.0.0.0',
        '8.8.8.8'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.updateIP(NETV4.uuid, ip, { reserved: true },
                function (err, res) {
                t.ok(err, 'error returned: ' + ip);
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'IP is not in subnet'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Update IP - invalid', function (t) {
    var invalid = [
        'a',
        '10.0.2.256'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.updateIP(NETV4.uuid, ip, { reserved: true },
                function (err, res) {
                t.ok(err, 'error returned: ' + ip);
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, {
                    code: 'ResourceNotFound',
                    message: 'Invalid IP address'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Update IP - invalid params (IP not in moray)', function (t) {
    vasync.forEachParallel({
        inputs: INVALID_PARAMS,
        func: function (data, cb) {
            var params = h.validIPparams();
            params[data[0]] = data[1];
            NAPI.updateIP(NETV4.uuid, '10.0.2.14', params, function (err, res) {
                t.ok(err, util.format('error returned: %s="%s"',
                    data[0], data[1]));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, {
                    code: 'InvalidParameters',
                    message: 'Invalid parameters',
                    errors: [
                        mod_err.invalidParam(data[0], data[2])
                    ]
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Update IP - invalid params (IP in moray)', function (t) {
    vasync.forEachParallel({
        inputs: INVALID_PARAMS,
        func: function (data, cb) {
            var params = h.validIPparams();
            params[data[0]] = data[1];
            NAPI.updateIP(NETV4.uuid, MORAY_IPV4, params, function (err2) {
                t.ok(err2, util.format('error returned: %s="%s"',
                    data[0], data[1]));
                if (!err2) {
                    return cb();
                }

                t.equal(err2.statusCode, 422, 'status code');
                t.deepEqual(err2.body, {
                    code: 'InvalidParameters',
                    message: 'Invalid parameters',
                    errors: [
                        mod_err.invalidParam(data[0], data[2])
                    ]
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


/*
 * If setting belongs_to_uuid or belongs_to_type, the other needs to be set
 * for the IP as well (either it should be already set in UFDS, or updated in
 * the same payload).  If either is set, owner_uuid needs to be set as well.
 */
test('Update IP - invalid param combinations (IP not in moray)', function (t) {
    vasync.forEachParallel({
        inputs: MULTIPLE_PARAMS_REQ,
        func: function (params, cb) {
            NAPI.updateIP(NETV4.uuid, '10.0.2.4', params, function (err, res) {
                t.ok(err, 'error returned: ' + JSON.stringify(params));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, {
                    code: 'InvalidParameters',
                    errors: ['belongs_to_uuid', 'belongs_to_type',
                        'owner_uuid'].filter(function (p) {
                            return !params.hasOwnProperty(p);
                        }).map(function (p) {
                            return h.missingParam(p, 'Missing parameter');
                    }).sort(h.fieldSort),
                    message: 'Missing parameters'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Update IP - invalid param combinations (IP in moray)', function (t) {
    vasync.forEachParallel({
        inputs: MULTIPLE_PARAMS_REQ,
        func: function (params, cb) {
            NAPI.updateIP(NETV4.uuid, MORAY_IPV4, params, function (err, res) {
                t.ok(err, 'error returned: ' + JSON.stringify(params));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, h.invalidParamErr({
                    errors: ['belongs_to_uuid', 'belongs_to_type',
                        'owner_uuid'].filter(function (p) {
                            return !params.hasOwnProperty(p);
                        }).map(function (p) {
                            return h.missingParam(p, 'Missing parameter');
                    }).sort(h.fieldSort),
                    message: 'Missing parameters'
                }), 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Update IP - both missing and invalid params (IP not in moray)',
    function (t) {
    NAPI.updateIP(NETV4.uuid, '10.0.2.4', { belongs_to_uuid: 'asdf' },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID')
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Update IP - both missing and invalid params (IP in moray)', function (t) {
    NAPI.updateIP(NETV4.uuid, MORAY_IPV4, { belongs_to_uuid: 'asdf' },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                h.missingParam('belongs_to_type', 'Missing parameter'),
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                h.missingParam('owner_uuid', 'Missing parameter')
            ]
        }), 'Error body');

        return t.end();
    });
});


/*
 * Allow updating all parameters
 */
test('Update IP - valid param combinations (IP in moray)', function (t) {
    var ipParams = {
        belongs_to_type: 'other',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.25',
        owner_uuid: mod_uuid.v4(),
        reserved: true
    };

    NAPI.updateIP(NETV4.uuid, '10.0.2.25', ipParams, function (err, ipRes) {
        t.ifError(err);
        ipParams.free = false;
        ipParams.network_uuid = NETV4.uuid;

        t.deepEqual(ipRes, ipParams, 'response');

        var updateList = clone(MULTIPLE_PARAMS_REQ);
        updateList.push({ reserved: false });
        updateList.push({ owner_uuid: mod_uuid.v4() });

        vasync.forEachPipeline({
            'inputs': updateList,
            'func': function (params, cb) {
                NAPI.updateIP(NETV4.uuid, '10.0.2.25', params,
                    function (err2, obj, req, res) {
                    if (h.ifErr(t, err2, 'update IP')) {
                        cb();
                        return;
                    }

                    t.equal(res.statusCode, 200, 'status code: ' +
                        JSON.stringify(params));
                    for (var p in params) {
                        ipParams[p] = params[p];
                    }

                    t.deepEqual(obj, ipParams, 'response');

                    cb();
                });
            }
        }, function () {
            t.end();
        });
    });
});



test('Update IP - valid param combinations (IP not in moray)', function (t) {
    var i = 0;
    var updateList = [
        { reserved: false },
        { owner_uuid: mod_uuid.v4() },
        { belongs_to_uuid: mod_uuid.v4(),
            belongs_to_type: 'other',
            owner_uuid: mod_uuid.v4() }
    ];

    vasync.forEachPipeline({
        'inputs': updateList,
        'func': function (updateData, cb) {
            var ip = '10.0.2.22' + i;

            NAPI.updateIP(NETV4.uuid, ip, updateData,
                function (err, obj, req, res) {
                if (h.ifErr(t, err, 'update IP')) {
                    t.deepEqual(err.body, {}, 'error body: ' +
                        JSON.stringify(updateData));
                    cb();
                    return;
                }

                t.equal(res.statusCode, 200, 'status code: ' +
                    JSON.stringify(updateData));
                updateData.free =
                    updateData.hasOwnProperty('reserved') ? true : false;
                updateData.reserved = false;
                updateData.network_uuid = NETV4.uuid;
                updateData.ip = ip;
                t.deepEqual(obj, updateData, 'Response');

                cb();
            });
        }
    }, function () {
        t.end();
    });
});


test('Update IP - free (IP in moray)', function (t) {
    var params = {
        belongs_to_type: 'other',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.55',
        owner_uuid: mod_uuid.v4(),
        reserved: true
    };

    NAPI.updateIP(NETV4.uuid, '10.0.2.55', params, function (err) {
        t.ifError(err);

        NAPI.updateIP(NETV4.uuid, '10.0.2.55', { free: 'true' },
            function (err2, obj, req, res) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err.body, {}, 'error body');
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                free: true,
                ip: '10.0.2.55',
                network_uuid: NETV4.uuid,
                reserved: false
            }, 'Response');

            return t.end();
        });
    });
});


test('Update IP - free (IP not in moray)', function (t) {
    NAPI.updateIP(NETV4.uuid, '10.0.2.4', { free: 'true' },
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            free: true,
            ip: '10.0.2.4',
            network_uuid: NETV4.uuid,
            reserved: false
        }, 'Response');

        return t.end();
    });
});


test('Update IPv4 - unassign (IP in moray)', function (t) {
    var params = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    NAPI.updateIP(NETV4.uuid, '10.0.2.34', params, function (err) {
        t.ifError(err);

        NAPI.updateIP(NETV4.uuid, '10.0.2.34', { unassign: 'true' },
            function (err2, obj, req, res) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err.body, {}, 'error body');
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                ip: '10.0.2.34',
                free: false,
                network_uuid: NETV4.uuid,
                owner_uuid: params.owner_uuid,
                reserved: false
            }, 'Response');

            return t.end();
        });
    });
});


test('Update IPv4 - unassign (IP not in moray)', function (t) {
    NAPI.updateIP(NETV4.uuid, '10.0.2.35', { unassign: 'true' },
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.end();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: '10.0.2.35',
            free: true,
            network_uuid: NETV4.uuid,
            reserved: false
        }, 'Response');

        return t.end();
    });
});


// --- List Tests

function testIPv4List(t, opts, callback) {
    assert.object(t, 't');
    opts.type = 'ip';
    opts.reqType = 'list';
    NAPI.listIPs(NETV4.uuid, opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
}

test('Listing IPv4 failures', function (t) {
    t.plan(common.badLimitOffTests.length);

     for (var i = 0; i < common.badLimitOffTests.length; i++) {
        var blot = common.badLimitOffTests[i];
        t.test(blot.bc_name, function (t2) {
            testIPv4List(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    }

});


// --- Teardown



test('Stop server', mod_server.close);
