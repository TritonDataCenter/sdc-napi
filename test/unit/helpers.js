/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Test helpers for NAPI unit tests
 */

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../lib/common');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var ldapjs = require('ldapjs');
var mock_moray = require('../lib/mock-moray');
var mod_ip = require('../../lib/models/ip');
var mod_uuid = require('node-uuid');
var NAPI = require('../../lib/napi').NAPI;
var napiClient = require('sdc-clients/lib/napi');
var restify = require('restify');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var verror = require('verror');



// --- Globals



var JOBS = [];
// Set to log messages to stderr
var LOG = process.env.LOG || false;
var NET_NUM = 2;
var SERVER;



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
 * Creates a test NAPI server, and returns a client for accessing it
 */
function createClientAndServer(callback) {
    var log;
    if (LOG) {
        log = require('bunyan').createLogger({
            level: (process.env.LOG_LEVEL || 'warn'),
            name: process.argv[1],
            stream: process.stderr,
            serializers: restify.bunyan.serializers,
            src: true
        });

    } else {
        log = {
            child: function () { return log; },
            debug: function () { return false; },
            error: function () { return false; },
            info: function () { return false; },
            trace: function () { return false; },
            warn: function () { return false; }
        };
    }

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
            return callback(null, new napiClient({
                agent: false,
                url: server.info().url
            }));
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
 * Gets an IP record from fake moray
 */
function getIPrecord(network, ip) {
    var buckets = mock_moray._buckets;
    var bucketName = mod_ip.bucket(network).name;
    if (!buckets.hasOwnProperty(bucketName)) {
        return util.format('Bucket %s not found', bucketName);
    }

    return buckets[bucketName][util_ip.aton(ip).toString()];
}


/**
 * Gets all IP records for a network from fake moray
 */
function getIPrecords(network) {
    var buckets = mock_moray._buckets;
    var bucketName = mod_ip.bucket(network).name;
    if (!buckets.hasOwnProperty(bucketName)) {
        return util.format('Bucket %s not found', bucketName);
    }

    return Object.keys(buckets[bucketName]).map(function (key) {
        return buckets[bucketName][key];
    }).sort(function (a, b) { return Number(a.ip) > Number(b.ip); });
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
 * Returns the moray buckets
 */
function morayBuckets() {
    return mock_moray._buckets;
}


/**
 * Sets moray to return errors for the given operations
 */
function setMorayErrors(obj) {
    mock_moray._errors = obj;
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
        vlan_id: '0'
    };

    for (var o in override) {
        newNet[o] = override[o];
    }

    return newNet;
}



module.exports = {
    createClientAndServer: createClientAndServer,
    fieldSort: fieldSort,
    ifErr: common.ifErr,
    getIPrecord: getIPrecord,
    getIPrecords: getIPrecords,
    invalidParamErr: common.invalidParamErr,
    missingParam: missingParam,
    morayBuckets: morayBuckets,
    randomMAC: common.randomMAC,
    setMorayErrors: setMorayErrors,
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
