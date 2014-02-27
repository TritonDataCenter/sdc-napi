/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * NAPI: update network workflow
 */

// These must match the names available in the workflow VM:
var async = require('async');
var cnShared = require('wf-shared').cnapi;
var sdcClients = require('sdc-clients');



// --- Globals



// Make jslint happy:
var cnapiUrl;
var napiUrl;



var VERSION = '0.0.2';



// --- Workflow functions



/**
 * Validate all parameters necessary for the workflow
 */
function validateParams(job, callback) {
    var p;
    var globalsReq = {
        'CNAPI URL': cnapiUrl,
        'NAPI URL': napiUrl
    };

    var jobParamsReq = {
        'networks': 'network object list',
        'original_network': 'original network',
        'update_params': 'update parameters'
    };

    for (p in globalsReq) {
        if (!globalsReq[p]) {
            return callback('No ' + p + ' workflow parameter provided');
        }
    }

    for (p in jobParamsReq) {
        if (!job.params[p]) {
            return callback('No ' + p + ' parameter provided');
        }
    }

    return callback(null, 'parameters validated successfully');
}


/**
 * Find all servers with the nic tag for the network we're updating
 */
function getServerNics(job, callback) {
    var napi = new sdcClients.NAPI({ url: napiUrl });

    job.params.serverUUIDs = [];
    var params = {
        belongs_to_type: 'server',
        nic_tags_provided: [ job.params.original_network.nic_tag ]
    };

    napi.listNics(params, function (err, nics) {
        if (err) {
            return callback(err);
        }

        job.log.debug(nics.map(function (n) { return n.mac; }),
            'NICs retrieved from NAPI');

        for (var j = 0; j < nics.length; j++) {
            var nic = nics[j];

            if (job.params.serverUUIDs.indexOf(
                    nic['belongs_to_uuid']) == -1) {
                job.params.serverUUIDs.push(nic['belongs_to_uuid']);
            }
        }

        job.log.info({ serverUuids: job.params.serverUUIDs },
            'Server UUIDs retrieved');
        return callback(null, 'Server UUIDs retrieved');
    });
}


/**
 * Bulk update nics in CNAPI
 */
function updateNics(job, callback) {
    if (!job.params.serverUUIDs || job.params.serverUUIDs.length === 0) {
        return callback(null, 'No servers to update');
    }

    var cnapi = new sdcClients.CNAPI({ url: cnapiUrl });
    job.params.taskIDs = [];
    var updateParams = {
        original_network: job.params.original_network,
        networks: job.params.networks
    };

    async.forEach(job.params.serverUUIDs, function (uuid, cb) {
        var endpoint = '/servers/' + uuid + '/vms/nics/update';

        cnapi.post(endpoint, updateParams, function (err, task) {
            if (err) {
                if (err.restCode == 'InvalidVersion') {
                    // This is a 6.5 CN - updating nics is not supported
                    return cb();
                }
                return cb(err);
            }
            job.log.debug(task, 'Server "%s": task', uuid);

            job.params.taskIDs.push({ server_uuid: uuid, task_id: task.id});
            return cb(null);
        });
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null, 'Started update on ' +
            job.params.taskIDs.length + ' servers');
    });
}



// --- Exports



var workflow = module.exports = {
    name: 'net-update-' + VERSION,
    version: VERSION,
    chain: [ {
        name: 'validate_params',
        timeout: 10,
        retry: 1,
        body: validateParams
    }, {
        name: 'napi.get_server_nics',
        timeout: 10,
        retry: 1,
        body: getServerNics
    }, {
        name: 'cnapi.update_nics',
        timeout: 60,
        retry: 1,
        body: updateNics
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 180,
        retry: 1,
        body: cnShared.pollTasks
    } ],
    timeout: 270,
    onerror: [ {
        name: 'On error',
        body: function (job, cb) {
            return cb('Error executing job');
        }
    } ]
};
