/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /networks endpoints with owner_uuids specified
 */

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var nextIP;
var owner = mod_uuid.v4();
var owner2 = mod_uuid.v4();
var provisionable = [];
var state = {
    testName: 'network-owner'
};
var ufdsAdminUuid = helpers.ufdsAdminUuid;



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
            return t.done();
        }

        params.mac = res.mac;
        params.primary = false;

        if (!nextIP) {
            nextIP = state.network.provision_start_ip;
        } else {
            nextIP = util_ip.ntoa(util_ip.aton(nextIP) + 1);
        }
        params.ip = nextIP;

        helpers.addNetParamsToNic(state, params);
        t.deepEqual(res, params, 'nic params');

        return t.done();
    });
}


function createNetworkPool(t, name, params) {
    var pidName = name + '-' + process.pid;
    napi.createNetworkPool(pidName, params, function (err, res) {
        if (helpers.ifErr(t, err, 'create network pool ' + name)) {
            return t.done();
        }

        if (params.owner_uuids) {
            params.owner_uuids.sort();
        }
        params.networks.sort();
        params.uuid = res.uuid;
        params.nic_tag = state.nicTag.name;

        t.deepEqual(params, res, 'network pool ' + name);
        state[name] = res;
        return t.done();
    });
}


function deleteNetworkPool(t, name, callback) {
    napi.deleteNetworkPool(state[name].uuid, function (err) {
        t.ok(!err, 'deleted network pool ' + name);
        helpers.ifErr(t, err, 'deleting pool ' + name);

        return callback();
    });
}




// --- Setup



exports['create test nic tag'] = function (t) {
    helpers.createNicTag(t, napi, state);
};



// --- Tests



exports['Create network'] = function (t) {
    helpers.createNetwork(t, napi, state, { owner_uuids: [ owner ] });
};


exports['Create second network'] = function (t) {
    helpers.createNetwork(t, napi, state, { owner_uuids: [ owner ] },
        'ownerNet2');
};


exports['Create third network'] = function (t) {
    helpers.createNetwork(t, napi, state, { owner_uuids: [ owner2 ] },
        'ownerNet3');
};

exports['Create fourth network'] = function (t) {
    helpers.createNetwork(t, napi, state, { owner_uuids: [ owner2 ] },
        'ownerNet4');
};

exports['Create fifth network'] = function (t) {
    helpers.createNetwork(t, napi, state, { owner_uuids: [ mod_uuid.v4() ] },
        'ownerNet5');
};


exports['Create no owner network'] = function (t) {
    helpers.createNetwork(t, napi, state, { }, 'noOwner');
};


exports['Create second no owner network'] = function (t) {
    helpers.createNetwork(t, napi, state, { }, 'noOwner2');
};


exports['Create no owner network pool'] = function (t) {
    createNetworkPool(t, 'noOwnerPool', {
        networks: [ state.noOwner.uuid, state.noOwner2.uuid ]
    });
};


exports['Create owner network pool'] = function (t) {
    createNetworkPool(t, 'ownerPool', {
        networks: [ state.network.uuid, state.ownerNet2.uuid ],
        owner_uuids: [ owner ]
    });
};


exports['Create owner2 network pool'] = function (t) {
    createNetworkPool(t, 'ownerPool2', {
        networks: [ state.ownerNet3.uuid, state.ownerNet3.uuid ],
        owner_uuids: [ owner2 ]
    });
};


exports['provision: invalid owner'] = function (t) {
    napi.provisionNic(state.network.uuid, {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('owner_uuid', constants.OWNER_MATCH_MSG)
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['provision: admin owner_uuid'] = function (t) {
    checkProvisionSuccess(ufdsAdminUuid, t);
};


exports['provision: network owner_uuid'] = function (t) {
    checkProvisionSuccess(owner, t);
};


exports['get provisionable networks'] = function (t) {
    napi.listNetworks(function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        res.forEach(function (net) {
            if (!net.owner_uuids || net.owner_uuids.indexOf(owner) !== -1) {
                provisionable.push(net.uuid);
            }
        });

        provisionable.sort();
        return t.done();
    });
};


exports['provisionable_by network: owner'] = function (t) {
    var netUuid = state.ownerNet2.uuid;

    napi.getNetwork(netUuid, { params: { provisionable_by: owner } },
                    function (err, res) {
        if (helpers.ifErr(t, err, 'get network')) {
            return t.done();
        }

        t.deepEqual(res.uuid, netUuid);

        return t.done();
    });
};


exports['provisionable_by network: other owner'] = function (t) {
    var netUuid = state.ownerNet3.uuid;

    napi.getNetwork(netUuid, { params: { provisionable_by: owner } },
                    function (err, res) {
        t.deepEqual(err, {
            message: 'Owner cannot provision on network',
            statusCode: 403,
            body: {
                code: 'NotAuthorized',
                message: 'Owner cannot provision on network'
            },
            restCode: 'NotAuthorized',
            name: 'NotAuthorizedError'
        });

        t.ifError(res);

        return t.done();
    });
};


exports['provisionable_by networks'] = function (t) {
    napi.listNetworks({ provisionable_by: owner }, function (err, res) {
        if (helpers.ifErr(t, err, 'list networks')) {
            return t.done();
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

        return t.done();
    });
};


exports['provisionable_by network pools: owner'] = function (t) {
    napi.listNetworkPools({ provisionable_by: owner }, function (err, res) {
        if (helpers.ifErr(t, err, 'list network pools')) {
            return t.done();
        }

        var uuids = res.map(function (n) { return n.uuid; }).sort();
        t.deepEqual(uuids,
            [ state.noOwnerPool.uuid, state.ownerPool.uuid ].sort(),
            'provisionable_by returns correct list');
        return t.done();
    });
};


exports['provisionable_by network pools: owner2'] = function (t) {
    napi.listNetworkPools({ provisionable_by: owner2 }, function (err, res) {
        if (helpers.ifErr(t, err, 'list network pools')) {
            return t.done();
        }

        var uuids = res.map(function (n) { return n.uuid; }).sort();
        t.deepEqual(uuids,
            [ state.noOwnerPool.uuid, state.ownerPool2.uuid ].sort(),
            'provisionable_by returns correct list');
        return t.done();
    });
};


exports['provisionable_by network pools: other owner'] = function (t) {
    napi.listNetworkPools({ provisionable_by: mod_uuid.v4() },
        function (err, res) {
        if (helpers.ifErr(t, err, 'list network pools')) {
            return t.done();
        }

        var uuids = res.map(function (n) { return n.uuid; }).sort();
        t.deepEqual(uuids, [ state.noOwnerPool.uuid ].sort(),
            'provisionable_by returns correct list');
        return t.done();
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    vasync.pipeline({
    funcs: [
        function (_, cb) {
            deleteNetworkPool(t, 'noOwnerPool', cb);

        }, function (_, cb) {
            deleteNetworkPool(t, 'ownerPool', cb);

        }, function (_, cb) {
            deleteNetworkPool(t, 'ownerPool2', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'ownerNet2', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'ownerNet3', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'ownerNet4', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'ownerNet5', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'noOwner', cb);

        }, function (_, cb) {
            helpers.deleteNetwork(t, napi, state, 'noOwner2', cb);

        }, function (_, cb) {
            helpers.deleteNicTags(t, napi, state);
        }
    ] }, function (err) {
        helpers.ifError(t, err, 'teardown pipeline');
        return t.done();
    });
};
