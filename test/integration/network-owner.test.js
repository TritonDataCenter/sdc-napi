/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Integration tests for /networks endpoints with owner_uuids specified
 */

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var mod_pool = require('../lib/pool');
var test = require('tape');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
var nextIP;
var owner = mod_uuid.v4();
var owner2 = mod_uuid.v4();
var provisionable = [];
var state = {
    noOwnerPools: [],
    testName: 'network-owner'
};
var ufdsAdminUuid;  // Loaded in setup below



// --- Helpers


/**
 * Provision a nic on the network with the given owner and check that it
 * succeeded
 */
function checkProvisionSuccess(newOwner, t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: newOwner
    };

    napi.provisionNic(state.network.uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'err body for debugging');
            return t.end();
        }

        params.mac = res.mac;
        params.primary = false;
        params.state = 'running';

        if (!nextIP) {
            nextIP = state.network.provision_start_ip;
        } else {
            nextIP = util_ip.ntoa(util_ip.aton(nextIP) + 1);
        }
        params.ip = nextIP;

        h.addNetParamsToNic(state, params);
        t.deepEqual(res, params, 'nic params');

        return t.end();
    });
}


function createNetworkPool(t, name, params) {
    var pidName = name + '-' + process.pid;
    napi.createNetworkPool(pidName, params, function (err, res) {
        if (h.ifErr(t, err, 'create network pool ' + name)) {
            return t.end();
        }

        if (params.owner_uuids) {
            params.owner_uuids.sort();
        }
        params.networks.sort();
        params.uuid = res.uuid;
        params.nic_tag = state.nicTag.name;

        t.deepEqual(params, res, 'network pool ' + name);
        state[name] = res;
        return t.end();
    });
}


function deleteNetworkPool(t, name, callback) {
    napi.deleteNetworkPool(state[name].uuid, function (err) {
        t.ok(!err, 'deleted network pool ' + name);
        h.ifErr(t, err, 'deleting pool ' + name);

        return callback();
    });
}




// --- Setup



test('create test nic tag', function (t) {
    h.createNicTag(t, napi, state);
});


test('load UFDS admin UUID', function (t) {
    h.loadUFDSadminUUID(t, function (adminUUID) {
        if (adminUUID) {
            ufdsAdminUuid = adminUUID;
        }

        return t.end();
    });
});


// For the provisionable_by tests below, we want to get a list of any pools
// without an owner that already exist, since these will show up in the
// list
test('populate no owner pool list', function (t) {
    mod_pool.list(t, { }, function (_, res) {
        if (res) {
            state.noOwnerPools = res.map(function (p) {
                return p.uuid;
            });
        }

        return t.end();
    });
});



// --- Tests



test('Create network', function (t) {
    h.createNetwork(t, napi, state, { owner_uuids: [ owner ] });
});


test('Create second network', function (t) {
    h.createNetwork(t, napi, state, { owner_uuids: [ owner ] },
        'ownerNet2');
});


test('Create third network', function (t) {
    h.createNetwork(t, napi, state, { owner_uuids: [ owner2 ] },
        'ownerNet3');
});

test('Create fourth network', function (t) {
    h.createNetwork(t, napi, state, { owner_uuids: [ owner2 ] },
        'ownerNet4');
});

test('Create fifth network', function (t) {
    h.createNetwork(t, napi, state, { owner_uuids: [ mod_uuid.v4() ] },
        'ownerNet5');
});


test('Create no owner network', function (t) {
    h.createNetwork(t, napi, state, { }, 'noOwner');
});


test('Create second no owner network', function (t) {
    h.createNetwork(t, napi, state, { }, 'noOwner2');
});


test('Create no owner network pool', function (t) {
    createNetworkPool(t, 'noOwnerPool', {
        networks: [ state.noOwner.uuid, state.noOwner2.uuid ]
    });
});


test('Create owner network pool', function (t) {
    createNetworkPool(t, 'ownerPool', {
        networks: [ state.network.uuid, state.ownerNet2.uuid ],
        owner_uuids: [ owner ]
    });
});


test('Create owner2 network pool', function (t) {
    createNetworkPool(t, 'ownerPool2', {
        networks: [ state.ownerNet3.uuid, state.ownerNet3.uuid ],
        owner_uuids: [ owner2 ]
    });
});


test('provision: invalid owner', function (t) {
    napi.provisionNic(state.network.uuid, {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('owner_uuid', constants.OWNER_MATCH_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('provision: admin owner_uuid', function (t) {
    checkProvisionSuccess(ufdsAdminUuid, t);
});


test('provision: network owner_uuid', function (t) {
    checkProvisionSuccess(owner, t);
});


test('get provisionable networks', function (t) {
    napi.listNetworks(function (err, res) {
        t.ifError(err);
        if (err) {
            return t.end();
        }

        res.forEach(function (net) {
            if (!net.owner_uuids || net.owner_uuids.indexOf(owner) !== -1) {
                provisionable.push(net.uuid);
            }
        });

        provisionable.sort();
        return t.end();
    });
});


test('provisionable_by network: owner', function (t) {
    var netUuid = state.ownerNet2.uuid;

    napi.getNetwork(netUuid, { params: { provisionable_by: owner } },
        function (err, res) {
        if (h.ifErr(t, err, 'get network')) {
            return t.end();
        }

        t.deepEqual(res.uuid, netUuid);

        return t.end();
    });
});


test('provisionable_by network: other owner', function (t) {
    var netUuid = state.ownerNet3.uuid;

    napi.getNetwork(netUuid, { params: { provisionable_by: owner } },
        function (err, res) {
        t.deepEqual(err, {
            message: constants.msg.NET_OWNER,
            statusCode: 403,
            body: {
                code: 'NotAuthorized',
                message: constants.msg.NET_OWNER
            },
            restCode: 'NotAuthorized',
            name: 'NotAuthorizedError'
        });

        t.ifError(res);

        return t.end();
    });
});


test('provisionable_by networks', function (t) {
    napi.listNetworks({ provisionable_by: owner }, function (err, res) {
        if (h.ifErr(t, err, 'list networks')) {
            return t.end();
        }

        var uuids = res.map(function (n) { return n.uuid; }).sort();
        t.deepEqual(uuids, provisionable,
            'provisionable_by returns correct list');
        t.ok(uuids.indexOf(state.network.uuid) !== -1,
            'list contains first network');
        t.ok(uuids.indexOf(state.ownerNet2.uuid) !== -1,
            'list contains second network');

        t.ok(uuids.indexOf(state.ownerNet3.uuid) === -1,
            'list does not contain third network');
        t.ok(uuids.indexOf(state.ownerNet4.uuid) === -1,
            'list does not contain fourth network');
        t.ok(uuids.indexOf(state.ownerNet5.uuid) === -1,
            'list does not contain fifth network');

        t.ok(uuids.indexOf(state.noOwner.uuid) !== -1,
            'list contains network with no owner');
        t.ok(uuids.indexOf(state.noOwner2.uuid) !== -1,
            'list contains second network with no owner');

        return t.end();
    });
});


test('provisionable_by network pools: owner', function (t) {
    t.test('list', function (t2) {
        napi.listNetworkPools({ provisionable_by: owner }, function (err, res) {
            if (h.ifErr(t2, err, 'list network pools')) {
                return t2.end();
            }

            var uuids = res.map(function (n) { return n.uuid; }).sort();
            t2.deepEqual(uuids,
                state.noOwnerPools.concat([
                    state.noOwnerPool.uuid, state.ownerPool.uuid ]).sort(),
                'provisionable_by returns correct list');
            return t2.end();
        });
    });

    t.test('get owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool.uuid,
            params: {
                provisionable_by: owner
            },
            exp: state.ownerPool
        });
    });

    t.test('get owner pool 2', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool2.uuid,
            params: {
                provisionable_by: owner
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });

    t.test('get no owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.noOwnerPool.uuid,
            params: {
                provisionable_by: owner
            },
            exp: state.noOwnerPool
        });
    });
});


test('provisionable_by network pools: owner2', function (t) {
    t.test('list', function (t2) {
        napi.listNetworkPools({ provisionable_by: owner2 },
            function (err, res) {
            if (h.ifErr(t2, err, 'list network pools')) {
                return t2.end();
            }

            var uuids = res.map(function (n) { return n.uuid; }).sort();
            t2.deepEqual(uuids,
                state.noOwnerPools.concat([
                    state.noOwnerPool.uuid, state.ownerPool2.uuid ]).sort(),
                'provisionable_by returns correct list');
            return t2.end();
        });
    });

    t.test('get owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool.uuid,
            params: {
                provisionable_by: owner2
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });

    t.test('get owner pool 2', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool2.uuid,
            params: {
                provisionable_by: owner2
            },
            exp: state.ownerPool2
        });
    });

    t.test('get no owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.noOwnerPool.uuid,
            params: {
                provisionable_by: owner2
            },
            exp: state.noOwnerPool
        });
    });
});


test('provisionable_by network pools: other owner', function (t) {
    t.test('list', function (t2) {
        napi.listNetworkPools({ provisionable_by: mod_uuid.v4() },
            function (err, res) {
            if (h.ifErr(t2, err, 'list network pools')) {
                return t2.end();
            }

            var uuids = res.map(function (n) { return n.uuid; }).sort();
            t2.deepEqual(uuids, state.noOwnerPools.concat(
                    [ state.noOwnerPool.uuid ]).sort(),
                'provisionable_by returns correct list');
            return t2.end();
        });
    });

    t.test('get owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool.uuid,
            params: {
                provisionable_by: mod_uuid.v4()
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });

    t.test('get owner pool 2', function (t2) {
        mod_pool.get(t2, {
            uuid: state.ownerPool2.uuid,
            params: {
                provisionable_by: mod_uuid.v4()
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });

    t.test('get no owner pool', function (t2) {
        mod_pool.get(t2, {
            uuid: state.noOwnerPool.uuid,
            params: {
                provisionable_by: mod_uuid.v4()
            },
            exp: state.noOwnerPool
        });
    });
});



// --- Teardown



test('teardown', function (t) {
    vasync.pipeline({
    funcs: [
        function (_, cb) {
            deleteNetworkPool(t, 'noOwnerPool', cb);

        }, function (_, cb) {
            deleteNetworkPool(t, 'ownerPool', cb);

        }, function (_, cb) {
            deleteNetworkPool(t, 'ownerPool2', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'ownerNet2', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'ownerNet3', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'ownerNet4', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'ownerNet5', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'noOwner', cb);

        }, function (_, cb) {
            h.deleteNetwork(t, napi, state, 'noOwner2', cb);

        }, function (_, cb) {
            h.deleteNicTags(t, napi, state);
        }
    ] }, function (err) {
        h.ifError(t, err, 'teardown pipeline');
        return t.end();
    });
});
