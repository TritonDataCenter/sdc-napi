/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for provisioning IPs
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var log = require('../lib/log');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var mod_pool = require('../lib/pool');
var mod_tag = require('../lib/nic-tag');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
var d = {};
var state = {
    deleted: [],
    delayed: [],
    nics: []
};
var uuids = {
    admin: '',  // Loaded in setup below
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
 * Checks to make sure the error matches the network pool full error
 */
function expPoolFull(t, err) {
    t.ok(err, 'error returned');
    if (!err) {
        return;
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, h.invalidParamErr({
        errors: [
            mod_err.invalidParam('network_uuid', constants.POOL_FULL_MSG)
        ]
    }), 'error');
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
function expProvisionFail(t, opts) {
    assert.object(opts, 'opts');
    assert.string(opts.network_uuid, 'opts.network_uuid');
    var mac = h.randomMAC();
    var params = clone(NIC_PARAMS);
    params.network_uuid = opts.network_uuid;

    log.debug({ mac: mac, params: params }, 'expProvisionFail');
    napi.createNic(mac, params, function (err, res) {
        if (opts.pool) {
            expPoolFull(t, err);
        } else {
            expSubnetFull(t, err);
        }

        if (res) {
            t.deepEqual(res, {}, 'IP unexpectedly found');
        }

        return t.end();
    });
}


/**
 * Provision a network until there are no more free IPs left
 */
function fillNetworkByCreate(t, opts) {
    assert.object(opts, 'opts');
    assert.string(opts.network_uuid, 'opts.network_uuid');
    assert.object(opts.params, 'opts.params');
    assert.object(opts.expNetwork, 'opts.expNetwork');

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
        var params = clone(opts.params);
        params.belongs_to_uuid = client.req_id;
        params.network_uuid = opts.network_uuid;

        d.belongsToExp.push(client.req_id);

        client.createNic(mac, params, function (err, res) {
            var desc = util.format(
                ' nic %d: mac=%s, belongs_to_uuid=%s, net=%s',
                num, mac, client.req_id, params.network_uuid);

            if (!h.ifErr(t, err, 'provision ' + desc)) {
                t.equal(res.network_uuid, opts.expNetwork.uuid,
                    'network_uuid' + desc);
                t.equal(res.belongs_to_uuid, client.req_id,
                    'belongs_to_uuid' + desc);

                ips.push(res.ip);
                d.ipToBelongsTo[res.ip] = res.belongs_to_uuid;
                state.nics.push(res);
                belongsTo.push(res.belongs_to_uuid);
            }

            barrier.done('create-' + num);
        });
    }

    var startNum = util_ip.aton(opts.expNetwork.provision_start_ip);
    var endNum = util_ip.aton(opts.expNetwork.provision_end_ip);
    var total = endNum - startNum + 1;
    log.debug({ startNum: startNum, endNum: endNum },
        'fillNetworkByCreate: creating %d nics', total);
    for (var i = startNum; i <= endNum; i++) {
        d.expIPs.push(util_ip.ntoa(i));
        doCreate(i);
    }

    barrier.on('drain', function () {
        log.debug('fillNetworkByCreate: done creating %d nics', total);

        t.equal(ips.length, endNum - startNum + 1,
            'correct number of IPs provisioned');
        t.deepEqual(ips.sort(ipSort), d.expIPs, 'All IPs provisioned');
        t.deepEqual(belongsTo.sort(), d.belongsToExp.sort(),
            'All belongs_to_uuids correct');

        return t.end();
    });
}


/**
 * Fill the subnet by provisioning 10 nics
 */
function createNics(t) {
    t.equal(state.nics.length, 0, 'no nics in state.nics');

    var barrier = vasync.barrier();

    function doCreate(num) {
        barrier.start('create-' + num);
        var client = h.createNAPIclient();
        var mac = h.randomMAC();
        var params = clone(NIC_PARAMS);
        params.belongs_to_uuid = client.req_id;

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
        return t.end();
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
                network_uuid: state.networks[0].uuid
            };

            d.belongsToExp.push(client.req_id);

            client.updateNic(mac, params, function (err, res) {
                var desc = util.format(
                    ' mac=%s, req_id=%s', mac, client.req_id);

                if (!h.ifErr(t, err, 'provision' + desc)) {
                    t.equal(res.network_uuid, state.networks[0].uuid,
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

        return t.end();
    });
}


function listIPs(t, opts) {
    assert.object(opts, 'opts');
    assert.object(opts.network, 'opts.network');

    napi.listIPs(opts.network.uuid, function (err, res) {
        if (h.ifErr(t, err, 'listing IPs')) {
            return t.end();
        }

        t.equal(res.length, 13, 'number of IPs correct');
        var bcAddr = util_ip.ntoa(
            util_ip.aton(opts.network.provision_end_ip) + 5);
        var before = util_ip.ntoa(
            util_ip.aton(opts.network.provision_start_ip) - 1);
        var after = util_ip.ntoa(
            util_ip.aton(opts.network.provision_end_ip) + 1);

        // The broadcast address will also be in the list as a
        // reserved IP:
        t.deepEqual(res.map(function (i) {
            return i.ip;
        }).sort(ipSort), d.expIPs.concat([bcAddr, before, after]).sort(ipSort),
            'All IPs returned');

        // The UFDS admin UUID will be included in the belongs_to_uuid
        // list, courtesy of the broadcast address:
        // The undefined owners are the unreserved placeholder IPs for the
        // provision range.
        t.deepEqual(res.map(function (i) {
            return i.belongs_to_uuid;
        }).sort(), d.belongsToExp.concat(
            [h.ufdsAdminUuid, undefined, undefined]).sort(),
            'All belongs_to_uuids returned');

        return t.end();
    });
}


function getIPs(t, opts) {
    assert.object(opts, 'opts');
    assert.object(opts.network, 'opts.network');

    vasync.forEachParallel({
        inputs: d.expIPs,
        func: function _getOne(ip, cb) {
            napi.getIP(opts.network.uuid, ip, function (err, res) {
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
        return t.end();
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
        return t.end();
    });
}


/*
 * Try to provision every IP on a subnet in parallel, and make sure that
 * we get a unique IP for each.  This is a variable because we want
 * to do this twice in this test.
 */
function fillNetwork(t) {
    t.test('fill', function (t2) {
        fillNetworkByCreate(t2, {
            network_uuid: state.networks[0].uuid,
            expNetwork: state.networks[0],
            params: NIC_PARAMS
        });
    });

    // Subnet should now be full
    t.test('provision with subnet full', function (t2) {
        expProvisionFail(t2, {
            network_uuid: state.networks[0].uuid
        });
    });

    t.test('list', function (t2) {
        listIPs(t2, { network: state.networks[0] });
    });

    // Make sure all IP params we care about are correct when getting them
    // individually
    t.test('get IPs', function (t2) {
        getIPs(t2, { network: state.networks[0] });
    });

    // Make sure nic params are correct when getting them individually
    t.test('get nics', getNics);
}


/*
 * Delete the last two nics provisioned, and ensure their IPs are freed
 */
function deleteTwoNics(t) {
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
                    if (h.ifErr(t, err2, 'get IP ' + nic.ip)) {
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
        return t.end();
    });
}


/**
 * Reprovision the deleted nics in state.deleted
 */
function reprovisionDeleted(t, opts) {
    assert.object(opts, 'opts');
    assert.object(opts.network, 'opts.network');

    var provisioned = [];
    var belongsTo = [];
    var belongsToExp = [];

    t.ok(state.deleted.length !== 0, 'IPs have been deleted');

    vasync.forEachParallel({
        inputs: state.deleted,
        func: function _delOne(_, cb) {
            var client = h.createNAPIclient();
            var desc = util.format(' (req_id=%s)', client.req_id);
            var params = clone(NIC_PARAMS);
            params.belongs_to_uuid = client.req_id;
            params.network_uuid = opts.network.uuid;

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
    }, function (err) {
        t.ifError(err, 'reprovisioning all NICs should succeed');
        t.deepEqual(provisioned.sort(ipSort), state.deleted.map(function (n) {
            return n.ip;
        }).sort(ipSort), 'IPs reprovisioned');

        t.deepEqual(belongsTo.sort(), belongsToExp.sort(),
            'All belongs_to_uuids correct');

        state.deleted = [];

        // Subnet should be full again
        expProvisionFail(t, {
            network_uuid: opts.network.uuid,
            pool: opts.pool
        });
    });
}

/**
 * Delete all nics in state.nics
 */
function deleteAll(t) {
    t.test('delete', function (t2) {
        t2.equal(state.nics.length, 10, 'all nics accounted for');

        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delOne(nic, cb) {
                napi.deleteNic(nic.mac, function (err) {
                    if (h.ifErr(t2, err, 'delete nic ' + nic.mac)) {
                        return cb(err);
                    }

                    napi.getIP(nic.network_uuid, nic.ip, function (err2, ip) {
                        if (h.ifErr(t2, err2, 'get IP ' + nic.ip)) {
                            return cb(err);
                        }

                        t2.ok(ip.free, nic.ip + ': free');
                        t2.ok(!ip.hasOwnProperty('belongs_to_uuid'),
                            nic.ip + ': belongs_to_uuid');
                        t2.ok(!ip.hasOwnProperty('belongs_to_type'),
                            nic.ip + ': belongs_to_type');
                        t2.ok(!ip.hasOwnProperty('owner_uuid'),
                            nic.ip + ': owner_uuid');

                        return cb();
                    });
                });
            }
        }, function () {
            return t2.end();
        });
    });

    t.test('get', function (t2) {
        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delOne(nic, cb) {
                napi.getNic(nic.mac, function (err) {
                    t2.ok(err, 'error returned for nic ' + nic.mac);
                    t2.equal(err.body.code, 'ResourceNotFound',
                        'nic no longer exists');

                    return cb();
                });
            }
        }, function () {
            state.nics = [];
            return t2.end();
        });
    });
}



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

    t.test('nic tag', function (t2) {
        mod_tag.create(t2, { name: '<generate>', state: state });
    });

    t.test('net0', function (t2) {
        mod_net.create(t2, {
            params: {
                name: '<generate>',
                provision_end_ip: '10.0.1.10',
                provision_start_ip: '10.0.1.1',
                subnet: '10.0.1.0/28',
                nic_tag: mod_tag.lastCreated().name,
                vlan_id: 0
            },
            partialExp: {
                provision_end_ip: '10.0.1.10',
                provision_start_ip: '10.0.1.1',
                subnet: '10.0.1.0/28'
            },
            state: state
        });
    });

    t.test('net1', function (t2) {
        mod_net.create(t2, {
            params: {
                name: '<generate>',
                provision_start_ip: '10.0.2.20',
                provision_end_ip: '10.0.2.50',
                subnet: '10.0.2.0/26',
                nic_tag: mod_tag.lastCreated().name,
                vlan_id: 0
            },
            partialExp: {
                provision_start_ip: '10.0.2.20',
                provision_end_ip: '10.0.2.50',
                subnet: '10.0.2.0/26'
            },
            state: state
        });
    });

    t.test('net2', function (t2) {
        mod_net.create(t2, {
            params: {
                name: '<generate>',
                provision_end_ip: '10.0.3.10',
                provision_start_ip: '10.0.3.1',
                subnet: '10.0.3.0/28',
                nic_tag: mod_tag.lastCreated().name,
                vlan_id: 0
            },
            partialExp: {
                provision_end_ip: '10.0.3.10',
                provision_start_ip: '10.0.3.1',
                subnet: '10.0.3.0/28'
            },
            state: state
        });
    });

    t.test('net3', function (t2) {
        mod_net.create(t2, {
            params: {
                name: '<generate>',
                provision_end_ip: '10.0.4.10',
                provision_start_ip: '10.0.4.1',
                subnet: '10.0.4.0/28',
                nic_tag: mod_tag.lastCreated().name,
                vlan_id: 0
            },
            partialExp: {
                provision_end_ip: '10.0.4.10',
                provision_start_ip: '10.0.4.1',
                subnet: '10.0.4.0/28'
            },
            state: state
        });
    });

    t.test('pool', function (t2) {
        mod_pool.create(t2, {
            name: '<generate>',
            params: {
                networks: [ state.networks[2].uuid ]
            },
            partialExp: {
                networks: [ state.networks[2].uuid ],
                nic_tag: mod_tag.lastCreated().name
            },
            state: state
        });
    });
});



// --- Tests


/*
 * Create nics on the network until it's fully provisioned
 */
test('fill network', fillNetwork);

// XXX: do the same test as above, but with updateNic(): IOW, use updateNic()
// to fill a fresh network completely.


/*
 * Delete two of the nics, and make sure their IPs are freed
 */
test('delete two nics', deleteTwoNics);


/*
 * Now that we've deleted several IPs, try to reprovision them at the same
 * time
 */
test('reprovision deleted', function (t) {
    reprovisionDeleted(t, {
        network: state.networks[0]
    });
});


/*
 * Delete two nics, ensuring that there's a bit of time between each
 * delete - this ensures that when we reprovision them in the next test,
 * we get the oldest nic first.
 */
test('delete: in order', function (t) {
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
        t.ifError(err, 'successful deletes');
        return t.end();
    });
});


/**
 * Reprovision the deleted nics, ensuring that we get IPs in the order they
 * were freed above.
 */
test('reprovision: by modification time', function (t) {
    var provisioned = [];

    function provisionNext(_, cb) {
        var params = clone(NIC_PARAMS);
        params.network_uuid = state.networks[0].uuid;

        napi.createNic(h.randomMAC(), params, function (err, res) {
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
        t.ifError(err, 'successful provisions');
        t.deepEqual(state.delayed.map(function (n) {
            return n.ip;
        }), provisioned, 'IPs reprovisioned in modification order');

        // Subnet should be full again
        expProvisionFail(t, {
            network_uuid: state.networks[0].uuid
        });
    });
});


/*
 * Now delete all of the nics on the network, causing their IPs to be freed.
 */
test('delete all: 1', deleteAll);


/*
 * Fill the network a second time - this is actually testing a slightly
 * different code path than before, since the IP records already exist in
 * moray.
 */
test('fill network again', fillNetwork);

test('delete all: 2', deleteAll);

/*
 * Fill the network a third time, but this time do it by creating a bunch
 * of nics without IPs, and then adding IPs to them
 */
test('fill network by updating', function (t) {
    t.test('create', createNics);

    t.test('fill', fillNetworkByUpdate);

    // Subnet should now be full
    t.test('provision with subnet full', function (t2) {
        expProvisionFail(t2, {
            network_uuid: state.networks[0].uuid
        });
    });

    t.test('list', function (t2) {
        listIPs(t2, { network: state.networks[0] });
    });

    // Make sure all IP params we care about are correct when getting them
    // individually
    t.test('get IPs', function (t2) {
        getIPs(t2, { network: state.networks[0] });
    });

    // Make sure nic params are correct when getting them individually
    t.test('get nics', getNics);
});


test('delete all: 3', deleteAll);


test('update network provision range', function (t) {

    function prov(expected, cb) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        napi.provisionNic(state.networks[1].uuid, params, function (err, res) {
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

        napi.updateNetwork(state.networks[1].uuid, toUpdate,
            function (err, res) {
            if (h.ifErr(t, err, 'update network')) {
                return cb(err);
            }

            t.equal(res[param], newVal,
                param + ' changed');

            napi.getNetwork(state.networks[1].uuid, function (err2, res2) {
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
        return t.end();
    });
});


test('delete all: 4', deleteAll);


test('fill network pool', function (t) {
    t.test('fill', function (t2) {
        fillNetworkByCreate(t2, {
            network_uuid: state.pools[0].uuid,
            expNetwork: state.networks[2],
            params: NIC_PARAMS
        });
    });

    // Subnet should now be full
    t.test('provision with subnet full', function (t2) {
        expProvisionFail(t2, {
            network_uuid: state.pools[0].uuid,
            pool: true
        });
    });

    t.test('list', function (t2) {
        listIPs(t2, { network: state.networks[2] });
    });

    // Make sure all IP params we care about are correct when getting them
    // individually
    t.test('get IPs', function (t2) {
        getIPs(t2, { network: state.networks[2] });
    });

    // Make sure nic params are correct when getting them individually
    t.test('get nics', getNics);

    // Remove two nics from the pool, and reprovision twice to get back
    // the same IPs
    t.test('delete two nics', deleteTwoNics);

    t.test('reprovision deleted', function (t2) {
        reprovisionDeleted(t2, {
            network: state.pools[0],
            pool: true
        });
    });

    t.test('add net3 to pool', function (t2) {
        mod_pool.update(t2, {
            uuid: state.pools[0].uuid,
            params: {
                networks: [ state.networks[2].uuid, state.networks[3].uuid ]
            },
            partialExp: {
                networks: [
                    state.networks[2].uuid, state.networks[3].uuid
                ].sort()
            }
        });
    });

    // XXX: does this blow away state.nics?
    t.test('fill second network', function (t2) {
        fillNetworkByCreate(t2, {
            network_uuid: state.pools[0].uuid,
            expNetwork: state.networks[3],
            params: NIC_PARAMS
        });
    });

    // Subnet should now be full
    t.test('provision with second subnet full', function (t2) {
        expProvisionFail(t2, {
            network_uuid: state.pools[0].uuid,
            pool: true
        });
    });

    t.test('list 2', function (t2) {
        listIPs(t2, { network: state.networks[3] });
    });

    // Make sure all IP params we care about are correct when getting them
    // individually
    t.test('get IPs 2', function (t2) {
        getIPs(t2, { network: state.networks[3] });
    });

    // Make sure nic params are correct when getting them individually
    t.test('get nics 2', getNics);

    // Remove two nics from the pool, and reprovision twice to get back
    // the same IPs
    t.test('delete two nics', deleteTwoNics);

    t.test('reprovision deleted', function (t2) {
        reprovisionDeleted(t2, {
            network: state.pools[0],
            pool: true
        });
    });
});



// --- Teardown



test('teardown', function (t) {
    t.test('delete nics', function (t2) {
        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delNic(nic, cb) {
                napi.deleteNic(nic.mac, function (err) {
                    t2.ifError(err, 'delete ' + nic.mac);
                    if (err) {
                        t2.deepEqual(err.body, {}, 'error body');
                    }

                    return cb(err);
                });
            }
        }, function () {
            return t2.end();
        });
    });

    t.test('pool', function (t2) {
        mod_pool.del(t2, { uuid: state.pools[0].uuid });
    });

    t.test('net0', function (t2) {
        mod_net.del(t2, { uuid: state.networks[0].uuid });
    });

    t.test('net1', function (t2) {
        mod_net.del(t2, { uuid: state.networks[1].uuid });
    });

    t.test('net2', function (t2) {
        mod_net.del(t2, { uuid: state.networks[2].uuid });
    });

    t.test('net3', function (t2) {
        mod_net.del(t2, { uuid: state.networks[3].uuid });
    });

    t.test('tag', function (t2) {
        mod_tag.del(t2, { name: state.nic_tags[0].name });
    });
});
