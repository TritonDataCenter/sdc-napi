/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with nics
 */

var common = require('./common');
var log = require('./log');



// --- Globals



var NAPI;



// --- Internal



function initState(state) {
    if (!state.hasOwnProperty('nics')) {
        state.nics = [];
    }
}



// --- Exports



/**
 * Delete a nic
 */
function del(t, mac, callback) {
    if (typeof (mac) === 'object') {
        mac = mac.mac;
    }

    log.debug({ mac: mac }, 'delete nic');

    NAPI.deleteNic(mac, function (err, obj, _, res) {
        common.ifErr(t, err, 'delete aggr: ' + mac);
        t.equal(res.statusCode, 204, 'delete status code: ' + mac);

        return callback(err, obj);
    });
}


/**
 * Provision a nic (no IP address), with some default parameters
 * filled in
 */
function provision(t, state, params, callback) {
    initState(state);

    var mac = common.randomMAC();
    log.debug({ mac: mac, params: params }, 'provisioning nic');
    NAPI.createNic(mac, params, function (err, res) {
        common.ifErr(t, err, 'provisioning nic ' + mac);
        if (res) {
            state.nics.push(res);
        }

        return callback(err, res);
    });
}


/**
 * Provision num nics, and end the test when done
 */
function provisionN(t, state, num, params, otherName) {
    var done = 0;

    function _afterProvision(err, nic) {
        if (nic && otherName) {
            if (!state.hasOwnProperty(otherName)) {
                state[otherName] = [];
            }

            state[otherName].push(nic);
        }

        // Ignore errors - these will have failed tests in provisionNic()
        // above
        if (++done == num) {
            return t.done();
        }
    }

    for (var i = 0; i < num; i++) {
        provision(t, state, params, _afterProvision);
    }
}



module.exports = {
    get client() {
        return NAPI;
    },
    set client(obj) {
        NAPI = obj;
    },

    del: del,
    provision: provision,
    provisionN: provisionN
};
