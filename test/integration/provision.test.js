/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for provisioning IPs
 */

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');
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
    d: mod_uuid.v4()
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
 * Checks to make sure the error matches the subnet full error
 */
function expSubnetFull(t, err) {
    t.ok(err, 'error returned');
    if (!err) {
        return;
    }

    t.equal(err.statusCode, 507, 'status code');
    t.deepEqual(err.body, {
        code: 'SubnetFull',
        message: constants.SUBNET_FULL_MSG
    }, 'error');
}


/**
 * Try to provision a nic, and make sure it fails
 */
function expProvisionFail(t, callback) {
    napi.createNic(helpers.randomMAC(), NIC_PARAMS, function (err, res) {
        expSubnetFull(t, err);
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
        },

        function _net2(_, cb) {
            var params = {
                name: 'network-integration-2-' + process.pid,
                provision_start_ip: '10.0.2.20',
                provision_end_ip: '10.0.2.50',
                subnet: '10.0.2.0/26',
                nic_tag: state.nicTag.name
            };

            helpers.createNetwork(t, napi, state, params, 'net2', cb);
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


exports['update network provision range'] = function (t) {

    function prov(expected, cb) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        napi.provisionNic(state.net2.uuid, params, function (err, res) {
            // If we pass in null, we expect the provision to fail
            if (!expected) {
                expSubnetFull(t, err);
                return cb();
            }

            if (helpers.ifErr(t, err, 'provision nic')) {
                return cb(err);
            }

            t.equal(res.ip, expected, 'expected IP');
            state.nics.push(res);
            return cb();
        });
    }

    function updateParam(param, newVal, cb) {
        var toUpdate = {};
        toUpdate[param] = newVal;

        napi.updateNetwork(state.net2.uuid, toUpdate, function (err, res) {
            if (helpers.ifErr(t, err, 'update network')) {
                return cb(err);
            }

            t.equal(res[param], newVal,
                param + ' changed');

            napi.getNetwork(state.net2.uuid, function (err2, res2) {
                if (helpers.ifErr(t, err2, 'get network')) {
                    return cb(err2);
                }

                t.equal(res2[param], newVal,
                    'get: ' + param + ' changed');
                return cb();
            });
        });
    }

    vasync.pipeline({
    funcs: [
        // First provision should take provision_start_ip
        function (_, cb) { prov('10.0.2.20', cb); },

        // Now move provision_start_ip to before to previous start
        function (_, cb) {
            updateParam('provision_start_ip', '10.0.2.10', cb);
        },
        function (_, cb) { prov('10.0.2.10', cb); },
        function (_, cb) { prov('10.0.2.11', cb); },

        // Now move provision_start_ip to after
        function (_, cb) {
            updateParam('provision_start_ip', '10.0.2.30', cb);
        },
        function (_, cb) { prov('10.0.2.30', cb); },
        function (_, cb) { prov('10.0.2.31', cb); },

        // Now fill up the rest of the subnet
        function (_, cb) { updateParam('provision_end_ip', '10.0.2.34', cb); },
        function (_, cb) { prov('10.0.2.32', cb); },
        function (_, cb) { prov('10.0.2.33', cb); },
        function (_, cb) { prov('10.0.2.34', cb); },

        // Subnet is now full, so expect a failure:
        function (_, cb) { prov(null, cb); },

        // Add 2 more available IPs
        function (_, cb) { updateParam('provision_end_ip', '10.0.2.36', cb); },
        function (_, cb) { prov('10.0.2.35', cb); },
        function (_, cb) { prov('10.0.2.36', cb); },
        function (_, cb) { prov(null, cb); }

    ] }, function () {
        return t.done();
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
            helpers.deleteNetwork(t, napi, state, 'net2', function () {
                helpers.deleteNicTags(t, napi, state);
            });
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
