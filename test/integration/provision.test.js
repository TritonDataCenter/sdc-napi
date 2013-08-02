/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for provisioning IPs
 */

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var napi = helpers.createNAPIclient();
var state = {
    deleted: [],
    delayed: [],
    nics: []
};
var uuids = {
    admin: helpers.ufdsAdminUuid,
    a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2',
    b: '91abd897-566a-4ae5-80d2-1ba103221bbc',
    c: 'e8e2deb9-2d68-4e4e-9aa6-4962c879d9b1',
    d: UUID.v4()
};
var NIC_PARAMS = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
};



// --- Helper functions



/**
 * Sorts nic objects by IP address
 */
function ipSort(a, b) {
    return (util_ip.aton(a) > util_ip.aton(b)) ? 1 : -1;
}


/**
 * Try to provision a nic, and make sure it fails
 */
function expProvisionFail(t, callback) {
    napi.createNic(helpers.randomMAC(), NIC_PARAMS, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return callback();
        }

        t.equal(err.statusCode, 507, 'status code');
        t.deepEqual(err.body, {
            code: 'SubnetFull',
            message: constants.SUBNET_FULL_MSG
        }, 'error');

        return callback();
    });
}



// --- Setup



exports.setup = function (t) {
    vasync.pipeline({
    funcs: [
        function _nicTag(_, cb) {
            helpers.createNicTag(t, napi, state, cb);
        },

        function _net(_, cb) {
            var params = {
                name: 'network-integration-small' + process.pid,
                provision_end_ip: '10.0.1.10',
                provision_start_ip: '10.0.1.1',
                subnet: '10.0.1.0/28',
                nic_tag: state.nicTag.name
            };

            helpers.createNetwork(t, napi, state, params, cb);
        }

    ] }, function (err, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
        } else {
            NIC_PARAMS.network_uuid = state.network.uuid;
        }

        return t.done();
    });
};



// --- Tests



// Try to provision every IP on a subnet in parallel, and make sure that
// we get a unique IP for each
exports['fill network'] = function (t) {
    var exp = [];
    var ips = [];

    var barrier = vasync.barrier();

    function doCreate(num) {
        barrier.start('create-' + num);
        var mac = helpers.randomMAC();
        napi.createNic(mac, NIC_PARAMS, function (err, res) {
            barrier.done('create-' + num);
            t.ifError(err, 'provision nic ' + num);
            if (err) {
                t.deepEqual(err.body, {}, 'error body: ' + num);
                return;
            }

            t.equal(res.network_uuid, NIC_PARAMS.network_uuid,
                'network uuid: ' + num);
            ips.push(res.ip);
            state.nics.push(res);
        });
    }

    for (var i = 0; i < 10; i++) {
        exp.push('10.0.1.' + (i + 1));
        doCreate(i);
    }

    barrier.on('drain', function () {
        t.equal(ips.length, 10, '10 IPs provisioned');
        t.deepEqual(ips.sort(ipSort), exp, 'All IPs provisioned');

        // Subnet should now be full
        expProvisionFail(t, function () {
            return t.done();
        });
    });
};


exports['delete'] = function (t) {
    state.deleted.push(state.nics.pop());
    state.deleted.push(state.nics.pop());

    vasync.forEachParallel({
        inputs: state.deleted,
        func: function _delOne(nic, cb) {
            napi.deleteNic(nic.mac, function (err) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                }

                return cb(err);
            });
        }
    }, function () {
        return t.done();
    });
};


exports['reprovision'] = function (t) {
    var provisioned = [];
    vasync.forEachParallel({
        inputs: state.deleted,
        func: function _delOne(nic, cb) {
            napi.createNic(helpers.randomMAC(), NIC_PARAMS,
                function (err, res) {
                t.ifError(err, 'error returned');
                if (err) {
                    return cb(err);
                }

                provisioned.push(res.ip);
                state.nics.push(res);
                return cb();
            });
        }
    }, function () {
        t.deepEqual(provisioned.sort(ipSort), state.deleted.map(function (n) {
            return n.ip;
        }).sort(ipSort), 'IPs reprovisioned');

        // Subnet should be full again
        expProvisionFail(t, function () {
            return t.done();
        });
    });
};



exports['delete: in order'] = function (t) {
    var toDel = [
        state.nics.pop(),
        state.nics.pop()
    ];

    function delNext(_, cb) {
        var nic = toDel.pop();
        napi.deleteNic(nic.mac, function (err) {
            t.ifError(err);
            if (err) {
                t.deepEqual(err.body, {}, 'error body');
            }

            state.delayed.push(nic);
            return cb(err);
        });
    }

    function waitOneSecond(_, cb) {
        setTimeout(cb, 1000);
    }

    vasync.pipeline({
        funcs: [
            delNext,
            waitOneSecond,
            delNext
        ]
    }, function (err) {
        return t.done();
    });
};


exports['reprovision: by modification time'] = function (t) {
    var provisioned = [];

    function provisionNext(_, cb) {
        napi.createNic(helpers.randomMAC(), NIC_PARAMS,
            function (err, res) {
            t.ifError(err, 'error returned');
            if (err) {
                return cb(err);
            }

            provisioned.push(res.ip);
            state.nics.push(res);
            return cb();
        });
    }

    vasync.pipeline({
        funcs: [
            provisionNext,
            provisionNext
        ]
    }, function (err) {
        t.deepEqual(state.delayed.map(function (n) {
            return n.ip;
        }), provisioned, 'IPs reprovisioned in modification order');

        // Subnet should be full again
        expProvisionFail(t, function () {
            return t.done();
        });
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    vasync.forEachParallel({
        inputs: state.nics,
        func: function _delNic(nic, cb) {
            napi.deleteNic(nic.mac, function (err) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                }

                return cb(err);
            });
        }
    }, function () {
        helpers.deleteNetwork(t, napi, state, function () {
            helpers.deleteNicTags(t, napi, state);
        });
    });
};


// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
