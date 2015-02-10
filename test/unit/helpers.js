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

var assert = require('assert-plus');
var bunyan = require('bunyan');
var clone = require('clone');
var common = require('../lib/common');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var mock_moray = require('../lib/mock-moray');
var mod_client = require('../lib/client');
var mod_uuid = require('node-uuid');
var NAPI = require('../../lib/napi').NAPI;
var restify = require('restify');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var verror = require('verror');



// --- Globals



var JOBS = [];
var NET_NUM = 2;
var NET_IPS = {};
var SERVER;
var SERVER_URL;



// --- Fake workflow client object



function FakeWFclient(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');

    this.log = opts.log;
}


FakeWFclient.prototype.createJob = function createJob(name, params, callback) {
    var uuid = mod_uuid.v4();
    JOBS.push({
        uuid: uuid,
        name: name,
        params: params
    });

    process.nextTick(function () {
        return callback(null, { uuid: uuid });
    });
};



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
    var log = require('bunyan').createLogger({
        name: 'napi-test-server',
        serializers: bunyan.stdSerializers,
        streams: [
            {
                level: process.env.LOG_LEVEL || 'fatal',
                stream: process.stderr
            }
        ],
        src: true
    });

    var server = new NAPI({
        config: JSON.parse(fs.readFileSync(__dirname + '/test-config.json')),
        log: log
    });

    server.initialDataLoaded = true;
    server.moray = new mock_moray.FakeMoray({ log: log });
    server.wfapi = new FakeWFclient({ log: log });

    server.on('initialized', function () {
        server.start(function (err) {
            if (err) {
                return callback(err);
            }

            SERVER = server;
            var client = createClient();
            mod_client.set(client);

            return callback(null, client);
        });
    });

    server.init();
}


/**
 * Sorts an error array by field
 */
function fieldSort(a, b) {
    return (a.field > b.field) ? 1 : -1;
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
 * Sort by uuid property
 */
function uuidSort(a, b) {
    return (a.uuid > b.uuid) ? 1 : -1;
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
 * Returns the parameters for a valid network, potentially overriding with any
 * values in override
 */
function validNetworkParams(override) {
    var newNet = {
        name: 'myname',
        nic_tag: 'nic_tag',
        provision_end_ip: util.format('10.0.%d.254', NET_NUM),
        provision_start_ip: util.format('10.0.%d.1', NET_NUM),
        resolvers: ['8.8.8.8', '8.8.4.4'],
        subnet: util.format('10.0.%d.0/24', NET_NUM),
        vlan_id: 0
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
    missingParamErr: common.missingParamErr,
    missingParam: missingParam,
    nextProvisionableIP: nextProvisionableIP,
    get NET_NUM() {
        return NET_NUM;
    },
    randomMAC: common.randomMAC,
    get server() {
        return SERVER;
    },
    stopServer: stopServer,
    uuidSort: uuidSort,
    validIPparams: validIPparams,
    validNicparams: validNicparams,
    validNetworkParams: validNetworkParams,
    get wfJobs() {
        return JOBS;
    },
    set wfJobs(val) {
        JOBS = val;
    }
};
