/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for network endpoints
 */

var assert = require('assert-plus');
var constants = require('../../lib/util/constants');
var fs = require('fs');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var CONF = JSON.parse(fs.readFileSync(__dirname + '/test-config.json'));

// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var TAG;


// Test variables:
var nets = [];
var nic;
var owner = mod_uuid.v4();
var owner2 = mod_uuid.v4();
var owner3 = mod_uuid.v4();

var netParams = helpers.validNetworkParams({ owner_uuids: [ owner3, owner ] });
var net2Params = helpers.validNetworkParams({
    name: 'net2-' + process.pid,
    owner_uuids: [ owner3, owner ]
});
var net3Params = helpers.validNetworkParams({
    name: 'net3-' + process.pid,
    owner_uuids: [ mod_uuid.v4() ]
});
var net4Params = helpers.validNetworkParams({
    name: 'net4-' + process.pid
});
var net5Params = helpers.validNetworkParams({
    name: 'net5-' + process.pid,
    owner_uuids: [ owner2 ]
});
var pools = [];

var ip1 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 1);
var ip2 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 2);
var ip3 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 3);
var ip4 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 4);
var ip5 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 5);



// --- Helper functions



function provisionNetwork(newNetParams, t) {
    NAPI.createNetwork(newNetParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        if (newNetParams.owner_uuids) {
            res.owner_uuids.sort();
            newNetParams.owner_uuids.sort();
            t.deepEqual(res.owner_uuids, newNetParams.owner_uuids,
                'owner UUIDs');
        }

        nets.push(res);
        return t.done();
    });
}


function provisionNic(provisionOn, params, t, callback) {
    var p;
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4()
    };
    for (p in params) {
        provParams[p] = params[p];
    }

    NAPI.provisionNic(provisionOn, provParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return callback(err);
        }

        delete provParams.network_uuid;
        delete provParams.check_owner;
        for (p in provParams) {
            t.equal(res[p], provParams[p], p);
        }
        nic = res;

        return callback(null, res);
    });
}


function provisionNetworkNicWithOwner(newOwner, t) {
    return provisionNic(nets[0].uuid, { owner_uuid: newOwner },
        t, function (err, res) {
        if (err) {
            return t.done();
        }

        t.equal(res.owner_uuid, newOwner, 'owner_uuid');
        t.equal(res.network_uuid, nets[0].uuid, 'network_uuid');
        return t.done();
    });
}


function updateNic(updateParams, t) {
    NAPI.updateNic(nic.mac, updateParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        t.equal(res.network_uuid, nets[0].uuid, 'network_uuid');
        t.equal(res.owner_uuid, updateParams.owner_uuid, 'owner_uuid');

        return t.done();
    });
}


function updateNicFailure(params, t) {
    NAPI.updateNic(nic.mac, params, function (err, res) {
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
}


function createNic(params, ip, t) {
    var p;
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4()
    };

    for (p in params) {
        provParams[p] = params[p];
    }

    if (ip !== null) {
        provParams.ip = ip;
        provParams.network_uuid = nets[0].uuid;
    }

    NAPI.createNic(helpers.randomMAC(), provParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        for (p in provParams) {
            t.equal(res[p], provParams[p], p);
        }
        nic = res;

        return t.done();
    });
}


function updateIPWithDifferentOwner(t) {
    NAPI.updateIP(nets[0].uuid, ip1, {
        owner_uuid: mod_uuid.v4(),
        reserved: true
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
}


function successfulReserve(params, t) {
    var updateParams = {
        reserved: true
    };
    for (var p in params) {
        updateParams[p] = params[p];
    }

    t.ok(updateParams.owner_uuid, 'passed owner_uuid');

    NAPI.updateIP(nets[0].uuid, ip1, updateParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        t.deepEqual(res, {
                free: false,
                ip: ip1,
                network_uuid: nets[0].uuid,
                owner_uuid: updateParams.owner_uuid,
                reserved: true
            }, 'result');

        return t.done();
    });
}


function createPool(name, params, t) {
    NAPI.createNetworkPool(name, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        params.uuid = res.uuid;
        params.name = name;
        params.nic_tag = netParams.nic_tag;
        t.deepEqual(res, params, 'result');
        pools.push(res);

        NAPI.getNetworkPool(params.uuid, function (err2, res2) {
            t.ifError(err2, 'error returned');
            if (err2) {
                return t.done();
            }

            t.deepEqual(res2, params, 'get result');
            return t.done();
        });
    });
}


function updatePoolFailure(uuid, params, invalidNets, t) {
    NAPI.updateNetworkPool(uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        var invalidParam = mod_err.invalidParam('networks',
            constants.POOL_OWNER_MATCH_MSG);
        invalidParam.invalid = invalidNets;

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ invalidParam ]
        }), 'error body');

        return t.done();
    });
}



// --- Setup



exports['Initial setup'] = function (t) {
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        if (!NAPI) {
            return t.done();
        }

        // Match the name of the nic tag in helpers.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            t.ifError(err2);
            TAG = res2;
            return t.done();
        });
    });
};


exports['create network with owner_uuid'] = function (t) {
    provisionNetwork(netParams, t);
};


exports['create second network with owner_uuid'] = function (t) {
    provisionNetwork(net2Params, t);
};


exports['create third network with different owner_uuid'] = function (t) {
    provisionNetwork(net3Params, t);
};


exports['create fourth network with no owner_uuid'] = function (t) {
    provisionNetwork(net4Params, t);
};


exports['create fifth network with no owner_uuid'] = function (t) {
    provisionNetwork(net5Params, t);
};



// --- Network pool create tests



exports['create network pool with mismatched network owner_uuids']=
    function (t) {
    var params = {
        networks: [ nets[0].uuid, nets[2].uuid ],
        owner_uuids: [ owner ]
    };

    t.notEqual(nets[0].owner_uuids[0], nets[2].owner_uuids[0],
        'owner_uuids not equal');

    NAPI.createNetworkPool('pool1-fail-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        var invalidParam = mod_err.invalidParam('networks',
            constants.POOL_OWNER_MATCH_MSG);
        invalidParam.invalid = [ nets[2].uuid ];

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ invalidParam ]
        }), 'error body');

        return t.done();
    });
};


exports['create network pool with owner_uuid'] = function (t) {
    // pools[0]
    createPool('pool1-' + process.pid, {
        networks: [ nets[0].uuid, nets[1].uuid ].sort(),
        owner_uuids: [ owner ]
    }, t);
};


exports['create network pool: mixed owner_uuid and no owner_uuid'] =
    function (t) {
    // pools[1]
    createPool('pool2-' + process.pid, {
        networks: [ nets[0].uuid, nets[3].uuid ].sort(),
        owner_uuids: [ owner ]
    }, t);
};


exports['create network pool: no owner_uuid'] = function (t) {
    // pools[2]
    createPool('pool3-' + process.pid, {
        networks: [ nets[0].uuid, nets[3].uuid ].sort()
    }, t);
};



// --- Network pool update tests



exports['update network pool: mismatched network owner_uuid'] =
    function (t) {
    // Update to add a network with a different owner_uuid
    updatePoolFailure(pools[1].uuid, {
        networks: [ nets[0].uuid, nets[2].uuid, nets[3].uuid ].sort()
    }, [ nets[2].uuid ], t);
};


exports['update network pool: mismatched owner_uuid'] = function (t) {
    // Update a pool that has an owner to a different UUID that doesn't match
    updatePoolFailure(pools[1].uuid, {
        owner_uuids: [ mod_uuid.v4() ]
    }, [ nets[0].uuid ], t);
};


exports['update network pool: no owner_uuid to mismatched'] = function (t) {
    // Update a pool that has no owner to a UUID that doesn't match the
    // networks in the pool
    t.ok(!pools[2].owner_uuids, 'pool has no owner_uuids');
    updatePoolFailure(pools[2].uuid, {
        owner_uuids: [ mod_uuid.v4() ]
    }, [ nets[0].uuid ], t);
};


exports['update network pool: mismatched owner_uuid'] = function (t) {
    // Update both owner_uuid and networks, including one network
    // whose owner_uuid doesn't match
    updatePoolFailure(pools[1].uuid, {
        networks: [ nets[0].uuid, nets[2].uuid ],
        owner_uuids: [ owner ]
    }, [ nets[2].uuid ], t);
};


exports['update network pool: no owner_uuid to one'] = function (t) {
    var params = {
        owner_uuids: [ nets[0].owner_uuids[0] ]
    };

    NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.deepEqual(res.owner_uuids, params.owner_uuids, 'owner_uuids');

        return t.done();
    });
};


exports['update network pool: networks and owner_uuid'] = function (t) {
    var params = {
        networks: [ nets[4].uuid ],
        owner_uuids: [ owner2 ]
    };

    t.deepEqual(nets[4].owner_uuids, [ owner2 ], 'owner_uuid equal');

    NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        pools[2].networks = params.networks;
        pools[2].owner_uuids = params.owner_uuids;
        t.deepEqual(res, pools[2], 'result');

        return t.done();
    });
};


exports['update network pool: remove owner_uuids'] = function (t) {
    var params = {
        owner_uuids: ''
    };

    NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        delete pools[2].owner_uuids;
        t.deepEqual(res, pools[2], 'result');
        t.ok(!res.hasOwnProperty('owner_uuids'), 'no owner_uuids present');

        NAPI.getNetworkPool(pools[2].uuid, function (err2, res2) {
            t.ifError(err2, 'error returned');
            if (err2) {
                return t.done();
            }

            t.deepEqual(res2, pools[2], 'get result');
            return t.done();
        });
    });
};



// --- Nic provision tests



exports['provisioning nic on network pool with same owner_uuid'] =
    function (t) {
    return provisionNic(pools[0].uuid, { owner_uuid: owner }, t,
        function (err, res) {
        if (err) {
            return t.done();
        }

        t.ok(pools[0].networks.indexOf(res.network_uuid) !== -1,
            'provisioned on one of the pool networks');

        return t.done();
    });
};


exports['provisioning nic with a different owner_uuid'] = function (t) {
    NAPI.provisionNic(nets[0].uuid, {
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


exports['provision nic on network with check_owner = false'] =
    function (t) {
    var otherOwner = mod_uuid.v4();
    // XXX return provisionNic(pools[0].uuid, { owner_uuid: owner }, t,
    return provisionNic(nets[0].uuid, {
        owner_uuid: otherOwner,
        check_owner: false
    }, t, function (err, res) {
        if (err) {
            return t.done();
        }

        t.equal(res.owner_uuid, otherOwner, 'owner_uuid');
        t.equal(res.network_uuid, nets[0].uuid, 'network_uuid');

        return t.done();
    });
};


exports['provision nic on network pool with check_owner = false'] =
    function (t) {
    var otherOwner = mod_uuid.v4();
    return provisionNic(pools[0].uuid, {
        owner_uuid: otherOwner,
        check_owner: false
    }, t, function (err, res) {
        if (err) {
            return t.done();
        }

        t.ok(pools[0].networks.indexOf(res.network_uuid) !== -1,
            'provisioned on one of the pool networks');

        return t.done();
    });
};


exports['provisioning nic with same owner_uuid'] = function (t) {
    provisionNetworkNicWithOwner(owner, t);
};


exports['provisioning nic with second owner_uuid'] = function (t) {
    provisionNetworkNicWithOwner(owner3, t);
};


exports['provisioning nic with admin owner_uuid'] = function (t) {
    provisionNetworkNicWithOwner(CONF.ufdsAdminUuid, t);
};



// --- Nic update tests



exports['updating nic to a different owner_uuid'] = function (t) {
    updateNicFailure({ owner_uuid: mod_uuid.v4() }, t);
};


exports['updating nic to admin owner_uuid'] = function (t) {
    updateNic({ owner_uuid: CONF.ufdsAdminUuid }, t);
};


exports['updating nic back to network owner_uuid'] = function (t) {
    updateNic({ owner_uuid: owner }, t);
};


exports['updating nic with check_owner = false'] = function (t) {
    updateNic({ owner_uuid: mod_uuid.v4(), check_owner: false }, t);
};



// --- Nic create tests



exports['creating nic with different owner_uuid'] = function (t) {
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: ip2,
        network_uuid: nets[0].uuid,
        owner_uuid: mod_uuid.v4()
    };

    t.notEqual(provParams.owner_uuid, nets[0].uuid, 'owner_uuids not equal');

    NAPI.createNic(helpers.randomMAC(), provParams, function (err, res) {
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


exports['creating nic with network owner_uuid'] = function (t) {
    createNic({ owner_uuid: owner }, ip2, t);
};


exports['creating nic with admin owner_uuid'] = function (t) {
    createNic({ owner_uuid: owner }, ip3, t);
};


exports['create nic: different owner and no IP (1)'] = function (t) {
    createNic({ owner_uuid: mod_uuid.v4() }, null, t);
};


exports['update nic with admin owner_uuid and IP'] = function (t) {
    updateNic({
        ip: ip4,
        network_uuid: nets[0].uuid,
        owner_uuid: CONF.ufdsAdminUuid
    }, t);
};


exports['create nic: different owner and no IP (2)'] = function (t) {
    createNic({ owner_uuid: mod_uuid.v4() }, null, t);
};


exports['update nic with network owner_uuid and IP'] = function (t) {
    updateNic({
        ip: ip5,
        network_uuid: nets[0].uuid,
        owner_uuid: owner
    }, t);
};


exports['update nic with different owner_uuid and IP'] = function (t) {
    updateNicFailure({
        ip: ip5,
        network_uuid: nets[0].uuid,
        owner_uuid: mod_uuid.v4()
    }, t);
};



// --- IP reservation tests



// First time reserving - the IP record is not in moray yet
exports['reserving IP for a different owner_uuid'] = updateIPWithDifferentOwner;


exports['reserving IP for same owner_uuid'] = function (t) {
    successfulReserve({ owner_uuid: owner }, t);
};


// Second time reserving - the IP record is now in moray
exports['updating IP to a different owner_uuid'] = updateIPWithDifferentOwner;


exports['reserving IP for admin owner_uuid'] = function (t) {
    successfulReserve({ owner_uuid: CONF.ufdsAdminUuid }, t);
};


exports['reserving IP with check_owner = false'] = function (t) {
    successfulReserve({ owner_uuid: mod_uuid.v4(), check_owner: false }, t);
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
