/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
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
var mod_ip = require('../../lib/models/ip');
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
        ]
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
 * Gets an IP record from fake moray
 */
function getIPrecord(network, ip) {
    var buckets = mock_moray._buckets;
    var bucketName = mod_ip.bucket(network).name;
    if (!buckets.hasOwnProperty(bucketName)) {
        return util.format('Bucket %s not found', bucketName);
    }

    var rec = buckets[bucketName][util_ip.aton(ip).toString()];
    if (rec) {
        return rec.value;
    }

    return null;
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
        return buckets[bucketName][key].value;
    }).sort(function (a, b) { return Number(a.ip) > Number(b.ip); });
}


/**
 * Gets mock moray errors
 */
function getMorayErrors() {
    return mock_moray._errors;
}

/**
 * Gets all nic records from fake moray, sorted by MAC address
 */
function getNicRecords(network, ip) {
    var bucket = mock_moray._buckets.napi_nics;
    if (!bucket) {
        return 'napi_nics bucket not found';
    }

    return Object.keys(bucket).sort().map(function (key) {
        return bucket[key];
    });
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
 * Returns the moray buckets
 */
function morayObj(bucketName, key) {
    var bucket = mock_moray._buckets[bucketName];
    assert.object(bucket, 'bucket');
    var obj = bucket[key];
    if (obj) {
        return obj.value;
    }

    return null;
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
    copyParams: copyParams,
    createClient: createClient,
    createClientAndServer: createClientAndServer,
    fieldSort: fieldSort,
    ifErr: common.ifErr,
    getIPrecord: getIPrecord,
    getIPrecords: getIPrecords,
    getMorayErrors: getMorayErrors,
    getNicRecords: getNicRecords,
    invalidParamErr: common.invalidParamErr,
    missingParamErr: common.missingParamErr,
    missingParam: missingParam,
    morayBuckets: morayBuckets,
    morayObj: morayObj,
    nextProvisionableIP: nextProvisionableIP,
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
