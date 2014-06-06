/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for provisioning IPs
 */

var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
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
var napi = h.createNAPIclient();
var d = {};
var state = {
    deleted: [],
    delayed: [],
    nics: []
};
var uuids = {
    admin: h.ufdsAdminUuid,
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
    napi.createNic(h.randomMAC(), NIC_PARAMS, function (err, res) {
        expSubnetFull(t, err);
        if (res) {
            t.deepEqual(res, {}, 'IP unexpectedly found');
        }

        return callback();
    });
}



// --- Setup



exports.setup = function (t) {
    vasync.pipeline({
    funcs: [
        function _nicTag(_, cb) {
            h.createNicTag(t, napi, state, cb);
        },

        function _net(_, cb) {
            var params = {
                name: 'network-integration-small' + process.pid,
                provision_end_ip: '10.0.1.10',
                provision_start_ip: '10.0.1.1',
                subnet: '10.0.1.0/28',
                nic_tag: state.nicTag.name
            };

            h.createNetwork(t, napi, state, params, cb);
        },

        function _net2(_, cb) {
            var params = {
                name: 'network-integration-2-' + process.pid,
                provision_start_ip: '10.0.2.20',
                provision_end_ip: '10.0.2.50',
                subnet: '10.0.2.0/26',
                nic_tag: state.nicTag.name
            };

            h.createNetwork(t, napi, state, params, 'net2', cb);
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



function fillNetworkByCreate(t) {
    var belongsTo = [];
    d.belongsToExp = [];
    d.expIPs = [];
    d.ipToBelongsTo = {};
    var ips = [];

    var barrier = vasync.barrier();

    function doCreate(num) {
        barrier.start('create-' + num);
        var client = h.createNAPIclient();
        var mac = h.randomMAC();
        var params = clone(NIC_PARAMS);
        params.belongs_to_uuid = client.req_id;

        d.belongsToExp.push(client.req_id);

        client.createNic(mac, params, function (err, res) {
            var desc = util.format(
                'nic %d: mac=%s, belongs_to_uuid=%s',
                num, mac, client.req_id);

            if (!h.ifErr(t, err, 'provision ' + desc)) {
                t.equal(res.network_uuid, NIC_PARAMS.network_uuid,
                    util.format('nic %d (%s) uuid=%s',
                        num, mac, NIC_PARAMS.network_uuid));
                t.equal(res.belongs_to_uuid, client.req_id,
                    'belongs_to_uuid ' + desc);

                ips.push(res.ip);
                d.ipToBelongsTo[res.ip] = res.belongs_to_uuid;
                state.nics.push(res);
                belongsTo.push(res.belongs_to_uuid);
            }

            barrier.done('create-' + num);
        });
    }

    for (var i = 0; i < 10; i++) {
        d.expIPs.push('10.0.1.' + (i + 1));
        doCreate(i);
    }

    barrier.on('drain', function () {
        t.equal(ips.length, 10, '10 IPs provisioned');
        t.deepEqual(ips.sort(ipSort), d.expIPs, 'All IPs provisioned');
        t.deepEqual(belongsTo.sort(), d.belongsToExp.sort(),
            'All belongs_to_uuids correct');

        return t.done();
    });
}

function createNics(t) {
    t.equal(state.nics.length, 0, 'no nics in state.nics');

    var barrier = vasync.barrier();

    function doCreate(num) {
        barrier.start('create-' + num);
        var client = h.createNAPIclient();
        var mac = h.randomMAC();
        var params = clone(NIC_PARAMS);
        params.belongs_to_uuid = client.req_id;
        delete params.network_uuid;

        client.createNic(mac, params, function (err, res) {
            var desc = util.format(
                ' nic %d: mac=%s, belongs_to_uuid=%s',
                num, mac, client.req_id);

            if (!h.ifErr(t, err, 'create' + desc)) {
                t.equal(res.belongs_to_uuid, client.req_id,
                    'belongs_to_uuid' + desc);

                t.ok(!res.hasOwnProperty('ip'), 'no IP for ' + mac + desc);
                t.ok(!res.hasOwnProperty('network_uuid'),
                    'no network_uuid for ' + mac + desc);
                state.nics.push(res);
            }

            barrier.done('create-' + num);
        });
    }

    for (var i = 0; i < 10; i++) {
        doCreate(i);
    }

    barrier.on('drain', function () {
        t.equal(state.nics.length, 10, '10 nics provisioned');
        return t.done();
    });
}

function fillNetworkByUpdate(t) {
    var belongsTo = [];
    d.belongsToExp = [];
    d.expIPs = [];
    d.ipToBelongsTo = {};
    var ips = [];
    var updatedNics = [];

    for (var i = 0; i < 10; i++) {
        d.expIPs.push('10.0.1.' + (i + 1));
    }

    vasync.forEachParallel({
        inputs: state.nics,
        func: function _getOne(nic, cb) {
            var client = h.createNAPIclient();
            var mac = nic.mac;
            var params = {
                belongs_to_uuid: client.req_id,
                network_uuid: NIC_PARAMS.network_uuid
            };

            d.belongsToExp.push(client.req_id);

            client.updateNic(mac, params, function (err, res) {
                var desc = util.format(
                    ' mac=%s, req_id=%s', mac, client.req_id);

                if (!h.ifErr(t, err, 'provision' + desc)) {
                    t.equal(res.network_uuid, NIC_PARAMS.network_uuid,
                        'network_uuid' + desc);
                    t.equal(res.belongs_to_uuid, client.req_id,
                        'belongs_to_uuid ' + desc);

                    ips.push(res.ip);
                    d.ipToBelongsTo[res.ip] = res.belongs_to_uuid;
                    belongsTo.push(res.belongs_to_uuid);
                    updatedNics.push(res);
                }

                return cb();
            });
        }
    }, function () {
        t.equal(ips.length, 10, '10 IPs provisioned');
        t.deepEqual(ips.sort(ipSort), d.expIPs, 'All IPs provisioned');
        t.deepEqual(belongsTo.sort(), d.belongsToExp.sort(),
            'All belongs_to_uuids correct');

        state.nics = updatedNics;

        return t.done();
    });
}


function expectProvisionFail(t) {
    expProvisionFail(t, function () {
        return t.done();
    });
}

function listIPs(t) {
    napi.listIPs(NIC_PARAMS.network_uuid, function (err, res) {
        if (h.ifErr(t, err, 'listing IPs')) {
            return t.done();
        }

        t.equal(res.length, 11, 'number of IPs correct');
        // The broadcast address will also be in the list as a
        // reserved IP:
        t.deepEqual(res.map(function (i) {
            return i.ip;
        }).sort(ipSort), d.expIPs.concat('10.0.1.15').sort(ipSort),
            'All IPs returned');

        // The UFDS admin UUID will be included in the belongs_to_uuid
        // list, courtesy of the broadcast address:
        t.deepEqual(res.map(function (i) {
            return i.belongs_to_uuid;
        }).sort(), d.belongsToExp.concat(h.ufdsAdminUuid).sort(),
            'All belongs_to_uuids returned');

        return t.done();
    });
}

function getIPs(t) {
    vasync.forEachParallel({
        inputs: d.expIPs,
        func: function _getOne(ip, cb) {
            napi.getIP(NIC_PARAMS.network_uuid, ip, function (err, res) {
                if (h.ifErr(t, err, 'get IP ' + ip)) {
                    return cb();
                }

                t.ok(res.ip, 'res.ip present');
                t.ok(d.ipToBelongsTo[res.ip], 'mapping for IP ' + res.ip);
                t.equal(res.belongs_to_uuid, d.ipToBelongsTo[res.ip],
                    'belongs_to_uuid correct for IP ' + res.ip);
                return cb();
            });
        }
    }, function () {
        return t.done();
    });
}

function getNics(t) {
    vasync.forEachParallel({
        inputs: state.nics,
        func: function _getOne(nic, cb) {
            napi.getNic(nic.mac, function (err, res) {
                if (h.ifErr(t, err, 'get nic ' + nic.mac)) {
                    return cb();
                }

                t.deepEqual(res, nic, 'nic correct');
                return cb();
            });
        }
    }, function () {
        return t.done();
    });
}


/*
 * Try to provision every IP on a subnet in parallel, and make sure that
 * we get a unique IP for each.  This is a variable because we want
 * to do this twice in this test.
 */
var fillNetwork = {
    'fill': fillNetworkByCreate,

    // Subnet should now be full
    'provision with subnet full': expectProvisionFail,

    'list': listIPs,

    // Make sure all IP params we care about are correct when getting them
    // individually
    'get IPs': getIPs,

    // Make sure nic params are correct when getting them individually
    'get nics': getNics
};


exports['fill network'] = fillNetwork;

// XXX: do the same test as above, but with updateNic()

/*
 * Delete two of the nics, and make sure their IPs are freed
 */
exports['delete'] = function (t) {
    state.deleted.push(state.nics.pop());
    state.deleted.push(state.nics.pop());

    vasync.forEachParallel({
        inputs: state.deleted,
        func: function _delOne(nic, cb) {
            napi.deleteNic(nic.mac, function (err) {
                if (h.ifErr(t, err, 'delete nic ' + nic.mac)) {
                    return cb(err);
                }

                napi.getIP(nic.network_uuid, nic.ip, function (err2, ip) {
                    if (h.ifErr(t, err, 'get IP ' + nic.ip)) {
                        return cb(err);
                    }

                    t.ok(ip.free, nic.ip + ': free');
                    t.ok(!ip.hasOwnProperty('belongs_to_uuid'),
                        nic.ip + ': belongs_to_uuid');
                    t.ok(!ip.hasOwnProperty('belongs_to_type'),
                        nic.ip + ': belongs_to_type');
                    t.ok(!ip.hasOwnProperty('owner_uuid'),
                        nic.ip + ': owner_uuid');

                    return cb();
                });
            });
        }
    }, function () {
        return t.done();
    });
};


/*
 * Now that we've deleted several IPs, try to reprovision them at the same
 * time
 */
exports['reprovision'] = function (t) {
    var provisioned = [];
    var belongsTo = [];
    var belongsToExp = [];

    t.ok(state.deleted.length !== 0, 'IPs have been deleted');

    vasync.forEachParallel({
        inputs: state.deleted,
        func: function _delOne(nic, cb) {
            var client = h.createNAPIclient();
            var desc = util.format(' (req_id=%s)', client.req_id);
            var params = clone(NIC_PARAMS);
            params.belongs_to_uuid = client.req_id;

            belongsToExp.push(client.req_id);

            client.createNic(h.randomMAC(), params, function (err, res) {
                if (h.ifErr(t, err, 'createNic' + desc)) {
                    return cb(err);
                }

                belongsTo.push(res.belongs_to_uuid);
                provisioned.push(res.ip);
                state.nics.push(res);
                return cb();
            });
        }
    }, function () {
        t.deepEqual(provisioned.sort(ipSort), state.deleted.map(function (n) {
            return n.ip;
        }).sort(ipSort), 'IPs reprovisioned');

        t.deepEqual(belongsTo.sort(), belongsToExp.sort(),
            'All belongs_to_uuids correct');

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

    // Wait between deleting nics - the next test reprovisions the deleted
    // IPs and confirms that they're provisioned oldest first.
    function waitABit(_, cb) {
        setTimeout(cb, 100);
    }

    vasync.pipeline({
        funcs: [
            delNext,
            waitABit,
            delNext
        ]
    }, function (err) {
        return t.done();
    });
};


exports['reprovision: by modification time'] = function (t) {
    var provisioned = [];

    function provisionNext(_, cb) {
        napi.createNic(h.randomMAC(), NIC_PARAMS,
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


var deleteAll = {
    'delete': function (t) {
        t.equal(state.nics.length, 10, 'all nics accounted for');

        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delOne(nic, cb) {
                napi.deleteNic(nic.mac, function (err) {
                    if (h.ifErr(t, err, 'delete nic ' + nic.mac)) {
                        return cb(err);
                    }

                    napi.getIP(nic.network_uuid, nic.ip, function (err2, ip) {
                        if (h.ifErr(t, err, 'get IP ' + nic.ip)) {
                            return cb(err);
                        }

                        t.ok(ip.free, nic.ip + ': free');
                        t.ok(!ip.hasOwnProperty('belongs_to_uuid'),
                            nic.ip + ': belongs_to_uuid');
                        t.ok(!ip.hasOwnProperty('belongs_to_type'),
                            nic.ip + ': belongs_to_type');
                        t.ok(!ip.hasOwnProperty('owner_uuid'),
                            nic.ip + ': owner_uuid');

                        return cb();
                    });
                });
            }
        }, function () {
            return t.done();
        });
    },

    'get': function (t) {
        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delOne(nic, cb) {
                napi.getNic(nic.mac, function (err) {
                    t.ok(err, 'error returned for nic ' + nic.mac);
                    t.equal(err.body.code, 'ResourceNotFound',
                        'nic no longer exists');

                    return cb();
                });
            }
        }, function () {
            state.nics = [];
            return t.done();
        });
    }
};


exports['delete all'] = deleteAll;


/*
 * Fill the network a second time - this is actually testing a slightly
 * different code path than before, since the IP records already exist in
 * moray.
 */
exports['fill network again'] = fillNetwork;

exports['delete all again'] = deleteAll;

/*
 * Fill the network a third time, but this time do it by creating a bunch
 * of nics without IPs, and then adding IPs to them
 */
exports['fill network by updating'] = {
    'create': createNics,

    'fill': fillNetworkByUpdate,

    // Subnet should now be full
    'provision with subnet full': expectProvisionFail,

    'list': listIPs,

    // Make sure all IP params we care about are correct when getting them
    // individually
    'get IPs': getIPs,

    // Make sure nic params are correct when getting them individually
    'get nics': getNics
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

            if (h.ifErr(t, err, 'provision nic')) {
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
            if (h.ifErr(t, err, 'update network')) {
                return cb(err);
            }

            t.equal(res[param], newVal,
                param + ' changed');

            napi.getNetwork(state.net2.uuid, function (err2, res2) {
                if (h.ifErr(t, err2, 'get network')) {
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
        h.deleteNetwork(t, napi, state, function () {
            h.deleteNetwork(t, napi, state, 'net2', function () {
                h.deleteNicTags(t, napi, state);
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
