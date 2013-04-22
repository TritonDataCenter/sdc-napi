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
var net;
var nic;
var owner = mod_uuid.v4();
var netParams = helpers.validNetworkParams({ owner_uuid: owner });
var ip1 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 1);
var ip2 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 2);
var ip3 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 3);
var ip4 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 4);
var ip5 = util_ip.ntoa(util_ip.aton(netParams.provision_end_ip) - 5);



// --- Helper functions



function provisionNicWithOwner(newOwner, t) {
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: newOwner
    };

    NAPI.provisionNic(net.uuid, provParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        for (var p in provParams) {
            t.equal(res[p], provParams[p], p);
        }
        t.equal(res.network_uuid, net.uuid, 'network_uuid');
        t.equal(res.owner_uuid, newOwner, 'owner_uuid');
        nic = res;

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

        t.equal(res.network_uuid, net.uuid, 'network_uuid');
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


function createNicWithOwner(newOwner, ip, t) {
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: newOwner
    };

    if (ip !== null) {
        provParams.ip = ip;
        provParams.network_uuid = net.uuid;
    }

    NAPI.createNic(helpers.randomMAC(), provParams, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        for (var p in provParams) {
            t.equal(res[p], provParams[p], p);
        }
        nic = res;

        return t.done();
    });
}


function updateIPWithDifferentOwner(t) {
    NAPI.updateIP(net.uuid, ip1, {
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


function successfulReserve(newOwner, t) {
    NAPI.updateIP(net.uuid, ip1, {
        owner_uuid: newOwner,
        reserved: true
    }, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.done();
        }

        t.deepEqual(res, {
                free: false,
                ip: ip1,
                owner_uuid: newOwner,
                reserved: true
            }, 'result');

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
            t.done();
        }

        // Match the name of the nic tag in helpers.validNetworkParams()
        NAPI.createNicTag('nic_tag', function (err2, res2) {
            t.ifError(err2);
            TAG = res2;
            t.done();
        });
    });
};


exports['create network with owner_uuid'] = function (t) {
    NAPI.createNetwork(netParams, function (err, res) {
        t.ifError(err, 'error returned');

        if (err) {
            return t.done();
        }

        t.equal(res.owner_uuid, owner, 'owner UUID');
        net = res;
        return t.done();
    });
};



// --- Nic tests



exports['provisioning nic with a different owner_uuid'] = function (t) {
    NAPI.provisionNic(net.uuid, {
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


exports['provisioning nic with same owner_uuid'] =
    provisionNicWithOwner.bind(null, owner);


exports['provisioning nic with admin owner_uuid'] =
    provisionNicWithOwner.bind(null, CONF.ufdsAdminUuid);


exports['updating nic to a different owner_uuid'] =
    updateNicFailure.bind(null, { owner_uuid: mod_uuid.v4() });


exports['updating nic to admin owner_uuid'] =
    updateNic.bind(null, { owner_uuid: CONF.ufdsAdminUuid });


exports['updating nic back to network owner_uuid'] =
    updateNic.bind(null, { owner_uuid: owner });


exports['creating nic with different owner_uuid'] = function (t) {
    var provParams = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: ip2,
        network_uuid: net.uuid,
        owner_uuid: mod_uuid.v4()
    };

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


exports['creating nic with network owner_uuid'] =
    createNicWithOwner.bind(null, owner, ip2);


exports['creating nic with admin owner_uuid'] =
    createNicWithOwner.bind(null, owner, ip3);


exports['create nic: different owner and no IP (1)'] =
    createNicWithOwner.bind(null, mod_uuid.v4(), null);


exports['update nic with admin owner_uuid and IP'] = function (t) {
    updateNic({
        ip: ip4,
        network_uuid: net.uuid,
        owner_uuid: CONF.ufdsAdminUuid
    }, t);
};


exports['create nic: different owner and no IP (2)'] =
    createNicWithOwner.bind(null, mod_uuid.v4(), null);


exports['update nic with network owner_uuid and IP'] = function (t) {
    updateNic({
        ip: ip5,
        network_uuid: net.uuid,
        owner_uuid: owner
    }, t);
};


exports['update nic with different owner_uuid and IP'] = function (t) {
    updateNicFailure({
        ip: ip5,
        network_uuid: net.uuid,
        owner_uuid: mod_uuid.v4()
    }, t);
};



// --- IP reservation tests



// First time reserving - the IP record is not in moray yet
exports['reserving IP for a different owner_uuid'] = updateIPWithDifferentOwner;


exports['reserving IP for same owner_uuid'] =
    successfulReserve.bind(null, owner);


// Second time reserving - the IP record is now in moray
exports['updating IP to a different owner_uuid'] = updateIPWithDifferentOwner;


exports['reserving IP for admin owner_uuid'] =
    successfulReserve.bind(null, CONF.ufdsAdminUuid);



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
