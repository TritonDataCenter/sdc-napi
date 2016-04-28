/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Unit tests for network endpoints
 */

'use strict';

var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_nic = require('../lib/nic');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util_ip = require('../../lib/util/ip');



// --- Globals



var CONF = require('../config.json');
var NAPI;
var TAG;


// Test variables:
var nets = [];
var nic;
var owner = mod_uuid.v4();
var owner2 = mod_uuid.v4();
var owner3 = mod_uuid.v4();
var otherOwner = mod_uuid.v4();

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

var ip1 = util_ip.ipAddrMinus(util_ip.toIPAddr(netParams.provision_end_ip), 1);
var ip2 = util_ip.ipAddrMinus(util_ip.toIPAddr(netParams.provision_end_ip), 2);
var ip3 = util_ip.ipAddrMinus(util_ip.toIPAddr(netParams.provision_end_ip), 3);
var ip4 = util_ip.ipAddrMinus(util_ip.toIPAddr(netParams.provision_end_ip), 4);
var ip5 = util_ip.ipAddrMinus(util_ip.toIPAddr(netParams.provision_end_ip), 5);



// --- Helper functions



function provisionNetwork(newNetParams, t) {
    NAPI.createNetwork(newNetParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.end();
        }

        if (newNetParams.owner_uuids) {
            res.owner_uuids.sort();
            newNetParams.owner_uuids.sort();
            t.deepEqual(res.owner_uuids, newNetParams.owner_uuids,
                'owner UUIDs');
        }

        nets.push(res);
        return t.end();
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
            return t.end();
        }

        t.equal(res.owner_uuid, newOwner, 'owner_uuid');
        t.equal(res.network_uuid, nets[0].uuid, 'network_uuid');
        return t.end();
    });
}


function updateNic(updateParams, t) {
    NAPI.updateNic(nic.mac, updateParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.end();
        }

        t.equal(res.network_uuid, nets[0].uuid, 'network_uuid');
        t.equal(res.owner_uuid, updateParams.owner_uuid, 'owner_uuid');

        return t.end();
    });
}


function updateNicFailure(params, t) {
    NAPI.updateNic(nic.mac, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('owner_uuid', constants.OWNER_MATCH_MSG)
            ]
        }), 'Error body');

        return t.end();
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
            return t.end();
        }

        for (p in provParams) {
            t.equal(res[p], provParams[p], p);
        }
        nic = res;

        return t.end();
    });
}


function updateIPWithDifferentOwner(t) {
    NAPI.updateIP(nets[0].uuid, ip1.toString(), {
        owner_uuid: mod_uuid.v4(),
        reserved: true
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('owner_uuid', constants.OWNER_MATCH_MSG)
            ]
        }), 'Error body');

        return t.end();
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

    NAPI.updateIP(nets[0].uuid, ip1.toString(), updateParams,
        function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.end();
        }

        t.deepEqual(res, {
                free: false,
                ip: ip1.toString(),
                network_uuid: nets[0].uuid,
                owner_uuid: updateParams.owner_uuid,
                reserved: true
            }, 'result');

        return t.end();
    });
}


function createPool(name, params, t) {
    NAPI.createNetworkPool(name, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.end();
        }

        params.uuid = res.uuid;
        params.name = name;
        params.nic_tag = netParams.nic_tag;
        t.deepEqual(res, params, 'result');
        pools.push(res);

        NAPI.getNetworkPool(params.uuid, function (err2, res2) {
            t.ifError(err2, 'error returned');
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, params, 'get result');
            return t.end();
        });
    });
}


function updatePoolFailure(uuid, params, invalidNets, t) {
    NAPI.updateNetworkPool(uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        var invalidParam = mod_err.invalidParam('networks',
            constants.POOL_OWNER_MATCH_MSG);
        invalidParam.invalid = invalidNets;

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [ invalidParam ]
        }), 'error body');

        return t.end();
    });
}



// --- Setup



test('setup', function (t) {
    t.plan(7);

    t.test('create client and server', function (t2) {
        helpers.createClientAndServer(function (err, res) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            NAPI = res;
            return t2.end();
        });
    });


    t.test('create nic tag', function (t2) {
        // Match the name of the nic tag in helpers.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            TAG = res2;
            t2.ifError(err2, 'no error creating NIC tag');
            t2.ok(TAG, 'created NIC tag');
            t2.end();
        });
    });


    t.test('create network with owner_uuid', function (t2) {
        provisionNetwork(netParams, t2);
    });


    t.test('create second network with owner_uuid', function (t2) {
        provisionNetwork(net2Params, t2);
    });


    t.test('create third network with different owner_uuid', function (t2) {
        provisionNetwork(net3Params, t2);
    });


    t.test('create fourth network with no owner_uuid', function (t2) {
        provisionNetwork(net4Params, t2);
    });


    t.test('create fifth network with no owner_uuid', function (t2) {
        provisionNetwork(net5Params, t2);
    });
});




// --- Network pool create tests



test('create', function (t) {
    t.plan(4);

    t.test('mismatched network owner_uuids', function (t2) {
        var params = {
            networks: [ nets[0].uuid, nets[2].uuid ],
            owner_uuids: [ owner ]
        };

        t2.notEqual(nets[0].owner_uuids[0], nets[2].owner_uuids[0],
            'owner_uuids not equal');

        NAPI.createNetworkPool('pool1-fail-' + process.pid, params,
            function (err, res) {
            t2.ok(err, 'error returned');
            if (!err) {
                return t2.end();
            }

            var invalidParam = mod_err.invalidParam('networks',
                constants.POOL_OWNER_MATCH_MSG);
            invalidParam.invalid = [ nets[2].uuid ];

            t2.equal(err.statusCode, 422, 'status code');
            t2.deepEqual(err.body, helpers.invalidParamErr({
                errors: [ invalidParam ]
            }), 'error body');

            return t2.end();
        });
    });


    t.test('with owner_uuid', function (t2) {
        // pools[0]
        createPool('pool1-' + process.pid, {
            networks: [ nets[0].uuid, nets[1].uuid ].sort(),
            owner_uuids: [ owner ]
        }, t2);
    });


    t.test('mixed owner_uuid and no owner_uuid', function (t2) {
        // pools[1]
        createPool('pool2-' + process.pid, {
            networks: [ nets[0].uuid, nets[3].uuid ].sort(),
            owner_uuids: [ owner ]
        }, t2);
    });


    t.test('no owner_uuid', function (t2) {
        // pools[2]
        createPool('pool3-' + process.pid, {
            networks: [ nets[0].uuid, nets[3].uuid ].sort()
        }, t2);
    });
});



// --- Network pool update tests



test('pool update', function (t) {
    t.test('mismatched network owner_uuid', function (t2) {
        // Update to add a network with a different owner_uuid
        updatePoolFailure(pools[1].uuid, {
            networks: [ nets[0].uuid, nets[2].uuid, nets[3].uuid ].sort()
        }, [ nets[2].uuid ], t2);
    });


    t.test('mismatched owner_uuid', function (t2) {
        // Update a pool that has an owner to a different UUID
        // that doesn't match
        updatePoolFailure(pools[1].uuid, {
            owner_uuids: [ mod_uuid.v4() ]
        }, [ nets[0].uuid ], t2);
    });


    t.test('no owner_uuid to mismatched', function (t2) {
        // Update a pool that has no owner to a UUID that doesn't match the
        // networks in the pool
        t2.ok(!pools[2].owner_uuids, 'pool has no owner_uuids');
        updatePoolFailure(pools[2].uuid, {
            owner_uuids: [ mod_uuid.v4() ]
        }, [ nets[0].uuid ], t2);
    });


    t.test('mismatched owner_uuid', function (t2) {
        // Update both owner_uuid and networks, including one network
        // whose owner_uuid doesn't match
        updatePoolFailure(pools[1].uuid, {
            networks: [ nets[0].uuid, nets[2].uuid ],
            owner_uuids: [ owner ]
        }, [ nets[2].uuid ], t2);
    });


    t.test('no owner_uuid to one', function (t2) {
        var params = {
            owner_uuids: [ nets[0].owner_uuids[0] ]
        };

        NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
            t2.ifError(err, 'error returned');
            if (err) {
                return t2.end();
            }

            t2.deepEqual(res.owner_uuids, params.owner_uuids, 'owner_uuids');

            return t2.end();
        });
    });


    t.test('networks and owner_uuid', function (t2) {
        var params = {
            networks: [ nets[4].uuid ],
            owner_uuids: [ owner2 ]
        };

        t2.deepEqual(nets[4].owner_uuids, [ owner2 ], 'owner_uuid equal');

        NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
            t2.ifError(err, 'error returned');
            if (err) {
                t2.deepEqual(err.body, {}, 'error body for debugging');
                return t2.end();
            }

            pools[2].networks = params.networks;
            pools[2].owner_uuids = params.owner_uuids;
            t2.deepEqual(res, pools[2], 'result');

            return t2.end();
        });
    });


    t.test('remove owner_uuids', function (t2) {
        var params = {
            owner_uuids: ''
        };

        NAPI.updateNetworkPool(pools[2].uuid, params, function (err, res) {
            t2.ifError(err, 'error returned');
            if (err) {
                t2.deepEqual(err.body, {}, 'error body for debugging');
                return t2.end();
            }

            delete pools[2].owner_uuids;
            t2.deepEqual(res, pools[2], 'result');
            t2.ok(!res.hasOwnProperty('owner_uuids'), 'no owner_uuids present');

            NAPI.getNetworkPool(pools[2].uuid, function (err2, res2) {
                t2.ifError(err2, 'error returned');
                if (err2) {
                    return t2.end();
                }

                t2.deepEqual(res2, pools[2], 'get result');
                return t2.end();
            });
        });
    });
});



// --- Nic provision tests



test('nic provision', function (t) {
    t.plan(7);

    t.test('on network pool with same owner_uuid', function (t2) {
        return provisionNic(pools[0].uuid, { owner_uuid: owner }, t2,
            function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(pools[0].networks.indexOf(res.network_uuid) !== -1,
                'provisioned on one of the pool networks');

            return t2.end();
        });
    });


    t.test('with a different owner_uuid', function (t2) {
        NAPI.provisionNic(nets[0].uuid, {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid: mod_uuid.v4()
        }, function (err, res) {
            t2.ok(err, 'error returned');
            if (!err) {
                return t2.end();
            }

            t2.equal(err.statusCode, 422, 'status code');
            t2.deepEqual(err.body, helpers.invalidParamErr({
                errors: [
                    mod_err.invalidParam('owner_uuid',
                        constants.OWNER_MATCH_MSG)
                ]
            }), 'Error body');

            return t2.end();
        });
    });


    t.test('on network with check_owner = false',
        function (t2) {
        var other = mod_uuid.v4();
        return provisionNic(nets[0].uuid, {
            owner_uuid: other,
            check_owner: false
        }, t2, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.equal(res.owner_uuid, other, 'owner_uuid');
            t2.equal(res.network_uuid, nets[0].uuid, 'network_uuid');

            return t2.end();
        });
    });


    t.test('on network pool with check_owner = false',
        function (t2) {
        var other = mod_uuid.v4();
        return provisionNic(pools[0].uuid, {
            owner_uuid: other,
            check_owner: false
        }, t2, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(pools[0].networks.indexOf(res.network_uuid) !== -1,
                'provisioned on one of the pool networks');

            return t2.end();
        });
    });


    t.test('with same owner_uuid', function (t2) {
        provisionNetworkNicWithOwner(owner, t2);
    });


    t.test('with second owner_uuid', function (t2) {
        provisionNetworkNicWithOwner(owner3, t2);
    });


    t.test('with admin owner_uuid', function (t2) {
        provisionNetworkNicWithOwner(CONF.ufdsAdminUuid, t2);
    });
});



// --- Nic update tests



test('nic update', function (t) {
    t.plan(4);

    t.test('to a different owner_uuid', function (t2) {
        updateNicFailure({ owner_uuid: mod_uuid.v4() }, t2);
    });


    t.test('to admin owner_uuid', function (t2) {
        updateNic({ owner_uuid: CONF.ufdsAdminUuid }, t2);
    });


    t.test('back to network owner_uuid', function (t2) {
        updateNic({ owner_uuid: owner }, t2);
    });


    t.test('with check_owner = false', function (t2) {
        updateNic({ owner_uuid: mod_uuid.v4(), check_owner: false }, t2);
    });
});



// --- Nic create tests



test('nic create', function (t) {
    t.plan(3);

    t.test('creating nic with different owner_uuid', function (t2) {
        var provParams = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: ip2.toString(),
            network_uuid: nets[0].uuid,
            owner_uuid: mod_uuid.v4()
        };

        t2.notEqual(provParams.owner_uuid, nets[0].uuid,
            'owner_uuids not equal');

        NAPI.createNic(helpers.randomMAC(), provParams, function (err, res) {
            t2.ok(err, 'error returned');
            if (!err) {
                return t2.end();
            }

            t2.equal(err.statusCode, 422, 'status code');
            t2.deepEqual(err.body, helpers.invalidParamErr({
                errors: [
                    mod_err.invalidParam('owner_uuid',
                        constants.OWNER_MATCH_MSG)
                ]
            }), 'Error body');

            return t2.end();
        });
    });


    t.test('creating nic with network owner_uuid', function (t2) {
        t2.plan(2);

        t2.test('create', function (t3) {
            createNic({ owner_uuid: owner }, ip2.toString(), t3);
        });

        t2.test('get', function (t3) {
            mod_nic.get(t3, {
                mac: nic.mac,
                partialExp: {
                    ip: ip2.toString(),
                    network_uuid: nets[0].uuid,
                    owner_uuid: owner
                }
            });
        });
    });


    t.test('creating nic with admin owner_uuid', function (t2) {
        t2.plan(2);

        t2.test('create', function (t3) {
            createNic({ owner_uuid: owner }, ip3.toString(), t3);
        });

        t2.test('get', function (t3) {
            mod_nic.get(t3, {
                mac: nic.mac,
                partialExp: {
                    ip: ip3.toString(),
                    network_uuid: nets[0].uuid,
                    owner_uuid: owner
                }
            });
        });
    });
});


test('update nic: add admin owner_uuid and IP', function (t) {
    t.plan(4);

    // Create a nic with no IP
    t.test('create', function (t2) {
        createNic({ owner_uuid: otherOwner }, null, t2);
    });

    t.test('get after create', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            partialExp: {
                owner_uuid: otherOwner
            }
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(!res.hasOwnProperty('ip'), 'no ip property');
            t2.ok(!res.hasOwnProperty('network_uuid'),
                'no network_uuid property');

            return t2.end();
        });
    });

    // Update it to add an IP: should be allowed because this is the
    // UFDS admin UUID
    t.test('update', function (t2) {
        updateNic({
            ip: ip4.toString(),
            network_uuid: nets[0].uuid,
            owner_uuid: CONF.ufdsAdminUuid
        }, t2);
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            partialExp: {
                ip: ip4.toString(),
                network_uuid: nets[0].uuid,
                owner_uuid: CONF.ufdsAdminUuid
            }
        });
    });
});


test('update nic with network owner_uuid and IP', function (t) {
    t.plan(5);

    // Create a nic with no IP
    t.test('create', function (t2) {
        createNic({ owner_uuid: otherOwner }, null, t2);
    });

    t.test('get after create', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            partialExp: {
                owner_uuid: otherOwner
            }
        }, function (err, res) {
            if (err) {
                return t2.end();
            }

            t2.ok(!res.hasOwnProperty('ip'), 'no ip property');
            t2.ok(!res.hasOwnProperty('network_uuid'),
                'no network_uuid property');

            return t2.end();
        });
    });

    // Update it to add an IP: should be allowed because we're updating it
    // to the owner of the network
    t.test('update', function (t2) {
        updateNic({
            // This is the fifth IP provisioned in this test, so it
            // will get ip5
            ip: ip5.toString(),
            network_uuid: nets[0].uuid,
            owner_uuid: owner
        }, t2);
    });

    t.test('get', function (t2) {
        mod_nic.get(t2, {
            mac: nic.mac,
            partialExp: {
                ip: ip5.toString(),
                network_uuid: nets[0].uuid,
                owner_uuid: owner
            }
        });
    });

    t.test('update with different owner_uuid and IP', function (t2) {
        // XXX: explain what this is doing
        updateNicFailure({
            ip: ip5.toString(),
            network_uuid: nets[0].uuid,
            owner_uuid: mod_uuid.v4()
        }, t2);
    });
});



// --- IP reservation tests



test('reserve', function (t) {
    t.plan(5);

    // First time reserving - the IP record is not in moray yet
    t.test('reserving IP for a different owner_uuid',
        updateIPWithDifferentOwner);


    t.test('reserving IP for same owner_uuid', function (t2) {
        successfulReserve({ owner_uuid: owner }, t2);
    });


    // Second time reserving - the IP record is now in moray
    t.test('updating IP to a different owner_uuid', updateIPWithDifferentOwner);


    t.test('reserving IP for admin owner_uuid', function (t2) {
        successfulReserve({ owner_uuid: CONF.ufdsAdminUuid }, t2);
    });


    t.test('reserving IP with check_owner = false', function (t2) {
        successfulReserve({ owner_uuid: mod_uuid.v4(), check_owner: false },
            t2);
    });
});



// --- Teardown



test('Stop server', function (t) {
    helpers.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
