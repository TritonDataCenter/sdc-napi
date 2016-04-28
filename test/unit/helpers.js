/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Test helpers for NAPI unit tests
 */

'use strict';

var assert = require('assert-plus');
var common = require('../lib/common');
var constants = require('../../lib/util/constants');
var mod_server = require('../lib/server');
var util = require('util');
var util_ip = require('../../lib/util/ip');



// --- Globals



var NET_NUM = 2;
var NET_IPS = {};
var SERVER;



// --- Exports



/**
 * Copies over all keys in from to to
 */
function copyParams(from, to) {
    for (var k in from) {
        to[k] = from[k];
    }
}


/**
 * Creates a NAPI client pointed at the test server (with req_id for tracking
 * requests)
 */
function createClient(t) {
    return common.createClient(SERVER.info().url, t);
}


/**
 * Creates a test NAPI server, and returns a client for accessing it
 */
function createClientAndServer(callback) {
    mod_server._create({
        unitTest: true
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        SERVER = res.server;
        return callback(null, res.client);
    });
}


/**
 * Sorts an error array by field
 */
function fieldSort(a, b) {
    return (a.field > b.field) ? 1 : -1;
}


/**
 * Sorts a list by IP fields
 */
function ipSort(a, b) {
    return (a.ip > b.ip) ? 1 : -1;
}


/**
 * Returns a missing parameter error array element
 */
function missingParam(field, message) {
    assert.string(field, 'field');
    assert.optionalString(message, 'message');

    return {
        code: 'MissingParameter',
        field: field,
        message: message || 'Missing parameter'
    };
}


/**
 * Get the next provisionable IP address for the network object passed in
 */
function nextProvisionableIP(net) {
    assert.object(net, 'net');
    if (!NET_IPS.hasOwnProperty(net.uuid)) {
        assert.string(net.provision_start_ip, 'net.provision_start_ip');
        NET_IPS[net.uuid] = util_ip.aton(net.provision_start_ip);
        assert.number(NET_IPS[net.uuid], 'NET_IPS[net.uuid]');
    }

    return util_ip.ntoa(NET_IPS[net.uuid]++);
}


/**
 * Stops the test NAPI server
 */
function stopServer(callback) {
    if (!SERVER) {
        return callback();
    }

    return SERVER.stop(callback);
}


/**
 * Returns the parameters for a valid IP, potentially overriding with any
 * values in override
 */
function validIPparams(override) {
    var newIP = {
        belongs_to_type: 'zone',
        belongs_to_uuid: '3c7f5393-7c69-4c7c-bc81-cb7aca031ff1',
        owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853'
    };

    for (var o in override) {
        newIP[o] = override[o];
    }

    return newIP;
}


/**
 * Returns the parameters for a valid IP, potentially overriding with any
 * values in override
 */
function validNicparams(override) {
    var newNic = {
        belongs_to_type: 'zone',
        belongs_to_uuid: '3c7f5393-7c69-4c7c-bc81-cb7aca031ff1',
        owner_uuid: '930896af-bf8c-48d4-885c-6573a94b1853'
    };

    for (var o in override) {
        newNic[o] = override[o];
    }

    return newNic;
}


/**
 * Returns the parameters for a valid IPv4 network, potentially overriding
 * with any values in override
 */
function validIPv4NetworkParams(override) {
    var newNet = {
        name: 'myname',
        nic_tag: 'nic_tag',
        provision_end_ip: util.format('10.0.%d.254', NET_NUM),
        provision_start_ip: util.format('10.0.%d.1', NET_NUM),
        resolvers: ['8.8.8.8', '8.8.4.4'],
        subnet: util.format('10.0.%d.0/24', NET_NUM),
        vlan_id: 0,
        mtu: constants.MTU_DEFAULT
    };

    for (var o in override) {
        newNet[o] = override[o];
    }
    NET_NUM++;

    return newNet;
}

/**
 * Returns the parameters for a valid IPv6 network, potentially overriding
 * with any values in override
 */
function validIPv6NetworkParams(override) {
    var NET_HEX = NET_NUM.toString(16);
    var newNet = {
        name: 'myname',
        nic_tag: 'nic_tag',
        provision_end_ip: util.format('fc00:%s::ffff:ffff:ffff:ffff', NET_HEX),
        provision_start_ip: util.format('fc00:%s::1', NET_HEX),
        resolvers: ['2001:4860:4860::8888', '2001:4860:4860::8844'],
        subnet: util.format('fc00:%s::/64', NET_HEX),
        vlan_id: 0,
        mtu: constants.MTU_DEFAULT
    };

    for (var o in override) {
        newNet[o] = override[o];
    }
    NET_NUM++;

    return newNet;
}

module.exports = {
    copyParams: copyParams,
    createClient: createClient,
    createClientAndServer: createClientAndServer,
    fieldSort: fieldSort,
    ifErr: common.ifErr,
    invalidParamErr: common.invalidParamErr,
    ipSort: ipSort,
    missingParamErr: common.missingParamErr,
    missingParam: missingParam,
    nextProvisionableIP: nextProvisionableIP,
    get NET_NUM() {
        return NET_NUM;
    },
    randomMAC: common.randomMAC,
    reqOpts: common.reqOpts,
    get server() {
        return SERVER;
    },
    stopServer: stopServer,
    uuidSort: common.uuidSort,
    validIPparams: validIPparams,
    validNicparams: validNicparams,
    validIPv6NetworkParams: validIPv6NetworkParams,
    validNetworkParams: validIPv4NetworkParams
};
