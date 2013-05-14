/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for IP endpoints
 */

var assert = require('assert-plus');
var async = require('async');
var clone = require('clone');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var MORAY_IP = '10.0.2.15';
var NON_MORAY_IP = '10.0.2.115';
var NAPI;
var NET;
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




// --- Internal helpers



// --- Setup



exports['Initial setup'] = function (t) {
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.done();
        }

        var netParams = helpers.validNetworkParams();
        NAPI.createNicTag(netParams.nic_tag, function (err2) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err2.body, {}, 'error body');
            }

            NAPI.createNetwork(netParams, function (err3, res3) {
                t.ifError(err3);
                if (err3) {
                    t.deepEqual(err3.body, {}, 'error body');
                    return t.done();
                }
                NET = res3;

                // Add an IP to moray
                NAPI.updateIP(NET.uuid, MORAY_IP, { reserved: true },
                    function (err4) {
                    t.ifError(err4);

                    return t.done();
                });
            });
        });
    });
};



// --- Get tests



exports['Get IP - non-existent network'] = function (t) {
    NAPI.getIP(mod_uuid.v4(), '1.2.3.4', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.done();
    });
};


exports['Get IP - outside subnet'] = function (t) {
    var invalid = [
        '10.0.3.1',
        '10.0.1.255',
        '8.8.8.8'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.getIP(NET.uuid, ip, function (err, res) {
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
        return t.done();
    });
};


exports['Get IP - invalid'] = function (t) {
    var invalid = [
        'a',
        '32',
        '10.0.2.256'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.getIP(NET.uuid, ip, function (err, res) {
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
        return t.done();
    });
};


exports['Get IP - record not in moray'] = function (t) {
    NAPI.getIP(NET.uuid, NON_MORAY_IP, function (err, obj, req, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: NON_MORAY_IP,
            network_uuid: NET.uuid,
            reserved: false,
            free: true
        }, 'response');

        return t.done();
    });
};


exports['Get IP - record in moray'] = function (t) {
    NAPI.getIP(NET.uuid, MORAY_IP, function (err, obj, req, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: MORAY_IP,
            network_uuid: NET.uuid,
            reserved: true,
            free: false
        }, 'response');

        return t.done();
    });
};



// --- Update tests



exports['Update IP - invalid network'] = function (t) {
    NAPI.updateIP('doesnotexist', '1.2.3.4', { reserved: true },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.done();
    });
};


exports['Update IP - non-existent network'] = function (t) {
    NAPI.updateIP(mod_uuid.v4(), '1.2.3.4', { reserved: true },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network not found'
        }, 'Error body');

        return t.done();
    });
};


exports['Update IP - outside subnet'] = function (t) {
    var invalid = [
        '10.0.3.1',
        '10.0.1.255',
        '8.8.8.8'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.updateIP(NET.uuid, ip, { reserved: true },
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
        return t.done();
    });
};


exports['Update IP - invalid'] = function (t) {
    var invalid = [
        'a',
        '32',
        '10.0.2.256'
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (ip, cb) {
            NAPI.updateIP(NET.uuid, ip, { reserved: true },
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
        return t.done();
    });
};


exports['Update IP - invalid params (IP not in moray)'] = function (t) {
    vasync.forEachParallel({
        inputs: INVALID_PARAMS,
        func: function (data, cb) {
            var params = helpers.validIPparams();
            params[data[0]] = data[1];
            NAPI.updateIP(NET.uuid, '10.0.2.14', params, function (err, res) {
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
        return t.done();
    });
};


exports['Update IP - invalid params (IP in moray)'] = function (t) {
    vasync.forEachParallel({
        inputs: INVALID_PARAMS,
        func: function (data, cb) {
            var params = helpers.validIPparams();
            params[data[0]] = data[1];
            NAPI.updateIP(NET.uuid, MORAY_IP, params, function (err2) {
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
        return t.done();
    });
};


/*
 * If setting belongs_to_uuid or belongs_to_type, the other needs to be set
 * for the IP as well (either it should be already set in UFDS, or updated in
 * the same payload).  If either is set, owner_uuid needs to be set as well.
 */
exports['Update IP - invalid param combinations (IP not in moray)'] =
    function (t) {
    vasync.forEachParallel({
        inputs: MULTIPLE_PARAMS_REQ,
        func: function (params, cb) {
            NAPI.updateIP(NET.uuid, '10.0.2.4', params, function (err, res) {
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
                            return helpers.missingParam(p, 'Missing parameter');
                    }).sort(helpers.fieldSort),
                    message: 'Missing parameters'
                }, 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.done();
    });
};


exports['Update IP - invalid param combinations (IP in moray)'] =
    function (t) {
    vasync.forEachParallel({
        inputs: MULTIPLE_PARAMS_REQ,
        func: function (params, cb) {
            NAPI.updateIP(NET.uuid, MORAY_IP, params, function (err, res) {
                t.ok(err, 'error returned: ' + JSON.stringify(params));
                if (!err) {
                    return cb();
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, helpers.invalidParamErr({
                    errors: ['belongs_to_uuid', 'belongs_to_type',
                        'owner_uuid'].filter(function (p) {
                            return !params.hasOwnProperty(p);
                        }).map(function (p) {
                            return helpers.missingParam(p, 'Missing parameter');
                    }).sort(helpers.fieldSort),
                    message: 'Missing parameters'
                }), 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.done();
    });
};


exports['Update IP - both missing and invalid params (IP not in moray)'] =
    function (t) {
    NAPI.updateIP(NET.uuid, '10.0.2.4', { belongs_to_uuid: 'asdf' },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                helpers.missingParam('belongs_to_type', 'Missing parameter'),
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                helpers.missingParam('owner_uuid', 'Missing parameter')
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['Update IP - both missing and invalid params (IP in moray)'] =
    function (t) {
    NAPI.updateIP(NET.uuid, MORAY_IP, { belongs_to_uuid: 'asdf' },
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                helpers.missingParam('belongs_to_type', 'Missing parameter'),
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                helpers.missingParam('owner_uuid', 'Missing parameter')
            ]
        }), 'Error body');

        return t.done();
    });
};


/*
 * Allow updating all parameters
 */
exports['Update IP - valid param combinations (IP in moray)'] =
    function (t) {
    var ipParams = {
        belongs_to_type: 'other',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.25',
        owner_uuid: mod_uuid.v4(),
        reserved: true
    };

    NAPI.updateIP(NET.uuid, '10.0.2.25', ipParams, function (err, ipRes) {
        t.ifError(err);
        ipParams.free = false;
        ipParams.network_uuid = NET.uuid;

        t.deepEqual(ipRes, ipParams, 'response');

        var updateList = clone(MULTIPLE_PARAMS_REQ);
        updateList.push({ reserved: false });
        updateList.push({ owner_uuid: mod_uuid.v4() });

        async.forEachSeries(updateList, function (params, cb) {
            NAPI.updateIP(NET.uuid, '10.0.2.25', params,
                function (err2, obj, req, res) {
                t.ifError(err2);
                if (err2) {
                    return cb();
                }

                t.equal(res.statusCode, 200, 'status code: ' +
                    JSON.stringify(params));
                for (var p in params) {
                    ipParams[p] = params[p];
                }

                t.deepEqual(obj, ipParams, 'response');

                return cb();
            });
        }, function () {
            return t.done();
        });
    });
};



exports['Update IP - valid param combinations (IP not in moray)'] =
    function (t) {
    var i = 0;
    var updateList = [
        { reserved: false },
        { owner_uuid: mod_uuid.v4() },
        { belongs_to_uuid: mod_uuid.v4(),
            belongs_to_type: 'other',
            owner_uuid: mod_uuid.v4() }
    ];

    async.forEachSeries(updateList, function (updateData, cb) {
        var ip = '10.0.2.22' + i;

        NAPI.updateIP(NET.uuid, ip, updateData,
            function (err, obj, req, res) {
            t.ifError(err);
            if (err) {
                t.deepEqual(err.body, {}, 'error body: ' +
                    JSON.stringify(updateData));
                return cb();
            }

            t.equal(res.statusCode, 200, 'status code: ' +
                JSON.stringify(updateData));
            updateData.free =
                updateData.hasOwnProperty('reserved') ? true : false;
            updateData.reserved = false;
            updateData.network_uuid = NET.uuid;
            updateData.ip = ip;
            t.deepEqual(obj, updateData, 'Response');

            return cb();
        });
    }, function () {
        return t.done();
    });
};


exports['Update IP - free (IP in moray)'] = function (t) {
    var params = {
        belongs_to_type: 'other',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.55',
        owner_uuid: mod_uuid.v4(),
        reserved: true
    };

    NAPI.updateIP(NET.uuid, '10.0.2.55', params, function (err) {
        t.ifError(err);

        NAPI.updateIP(NET.uuid, '10.0.2.55', { free: 'true' },
            function (err2, obj, req, res) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err.body, {}, 'error body');
                return t.done();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                free: true,
                ip: '10.0.2.55',
                network_uuid: NET.uuid,
                reserved: false
            }, 'Response');

            return t.done();
        });
    });
};


exports['Update IP - free (IP not in moray)'] = function (t) {
    NAPI.updateIP(NET.uuid, '10.0.2.4', { free: 'true' },
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            free: true,
            ip: '10.0.2.4',
            network_uuid: NET.uuid,
            reserved: false
        }, 'Response');

        return t.done();
    });
};


exports['Update IP - unassign (IP in moray)'] = function (t) {
    var params = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    NAPI.updateIP(NET.uuid, '10.0.2.34', params, function (err) {
        t.ifError(err);

        NAPI.updateIP(NET.uuid, '10.0.2.34', { unassign: 'true' },
            function (err2, obj, req, res) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err.body, {}, 'error body');
                return t.done();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                ip: '10.0.2.34',
                free: false,
                network_uuid: NET.uuid,
                owner_uuid: params.owner_uuid,
                reserved: false
            }, 'Response');

            return t.done();
        });
    });
};


exports['Update IP - unassign (IP not in moray)'] = function (t) {
    NAPI.updateIP(NET.uuid, '10.0.2.35', { unassign: 'true' },
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            ip: '10.0.2.35',
            free: true,
            network_uuid: NET.uuid,
            reserved: false
        }, 'Response');

        return t.done();
    });
};



// --- Teardown



exports['Stop server'] = function (t) {
    helpers.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports['Initial setup'],
        oneTest: runOne,
        teardown: exports['Stop server']
    };
}
