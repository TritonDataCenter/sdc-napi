/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * NAPI: update network workflow
 */

// These must match the names available in the workflow VM:
var async = require('async');
var sdcClients = require('sdc-clients');



// --- Globals



// Make jslint happy:
var napiUrl;
var vmapiUrl;



var VERSION = '0.0.1';



// --- Workflow functions



/**
 * Validate all parameters necessary for the workflow
 */
function validateParams(job, callback) {
    var p;
    var globalsReq = {
        'VMAPI URL': vmapiUrl,
        'NAPI URL': napiUrl
    };

    var jobParamsReq = {
        'network_uuid': 'network UUID',
        'updateParams': 'update parameters'
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
 * Get nics for the network
 */
function getNics(job, callback) {
    var napi = new sdcClients.NAPI({ url: napiUrl });
    var params = {
        belongs_to_type: 'zone',
        network_uuid: job.params.network_uuid
    };
    var vms = {};

    job.log.info(params, 'listing nics');
    napi.listNics(params, function (err, res) {
        if (err) {
            return callback(err);
        }

        job.log.info({ params: params, nics: res }, 'nics found');
        for (var n in res) {
            var nic = res[n];
            vms[nic.belongs_to_uuid] = true;
        }

        job.params.vm_uuids = Object.keys(vms);
        job.log.info({ vms: job.params.vm_uuids }, 'VM UUIDs');
        return callback(null, 'got VM UUIDs from NAPI');
    });
}


/**
 * Get VMs from VMAPI so that we know the order of each VM's nics
 */
function getVMs(job, callback) {
    if (!job.params.vm_uuids) {
        return callback(null, 'no VMs to lookup');
    }

    job.params.vms = [];

    var vmapi = new sdcClients.VMAPI({ url: vmapiUrl });
    async.mapSeries(job.params.vm_uuids, function (uuid, cb) {
        job.log.info('getting VM "%s"', uuid);
        vmapi.getVm({ uuid: uuid }, function (err, vm) {
            if (err) {
                return cb(err);
            }

            if (vm.state === 'destroyed' || !vm.hasOwnProperty('nics') ||
                vm.nics.length === 0 ||
                (vm.internal_metadata.hasOwnProperty('set_resolvers') &&
                !vm.internal_metadata.set_resolvers)) {
                job.log.info(vm, 'skipping VM "%s"', uuid);
                return cb();
            }

            job.params.vms.push({ uuid: vm.uuid, nics: vm.nics });
            return cb();
        });
    }, function (err) {
        if (err) {
            return callback(err);
        }

        job.log.info(job.params.vms, 'VMs retrieved');
        return callback(null, 'Retrieved VMs from VMAPI');
    });
}


/**
 * Get resolvers for a VM's nics, and start the update on VMAPI
 */
function updateResolvers(job, callback) {
    if (!job.params.vms) {
        return callback(null, 'no VMs to lookup resolvers for');
    }

    var napi = new sdcClients.NAPI({ url: napiUrl });
    var vmapi = new sdcClients.VMAPI({ url: vmapiUrl });
    job.params.jobs = [];

    async.forEach(job.params.vms, function (vm, cb) {
        job.log.info('getting nics for "%s"', vm.uuid);
        napi.getNics(vm.uuid, function (err, res) {
            if (err) {
                return callback(err);
            }

            var macResolvers = {};
            var resolvers = [];

            for (var n in res) {
                var nic = res[n];
                if (nic.hasOwnProperty('resolvers')) {
                    macResolvers[nic.mac] = nic.resolvers;
                }
            }

            // These are the NICs in the correct order
            for (var i = 0; i < vm.nics.length; i++) {
                var mac = vm.nics[i].mac;

                if (macResolvers[mac]) {
                    for (var j = 0; j < macResolvers[mac].length; j++) {
                        var resolver = macResolvers[mac][j];
                        if (resolvers.indexOf(resolver) === -1) {
                            resolvers.push(resolver);
                        }
                    }
                }
            }

            var updateParams = { uuid: vm.uuid, resolvers: resolvers };
            job.log.info(updateParams, 'Updating VM "%s"', vm.uuid);
            vmapi.updateVm(updateParams, function (err2, res2) {
                if (err2) {
                    return cb(err2);
                }

                job.params.jobs.push(res2);
                return cb();
            });
        });
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null, 'started updates on VMAPI');
    });
}


/**
 * Polls VMAPI waiting for jobs to complete
 */
function pollJobs(job, callback) {
    if (!job.params.jobs || job.params.jobs.length === 0) {
        return callback(null, 'No jobs to poll');
    }

    var vmapi = new sdcClients.VMAPI({ url: vmapiUrl });

    job.params.taskSuccesses = [];
    job.params.taskFailures = [];

    return async.forEach(job.params.jobs, function (detail, cb) {
        var intervalID = setInterval(interval, 1000);

        function interval() {
            vmapi.getJob(detail.job_uuid, function onVmapi(err, task) {
                if (err) {
                    clearInterval(intervalID);
                    return cb(err);
                }

                job.log.debug(task, 'retrieved task for VM "%s"',
                    detail.vm_uuid);
                if (task.execution == 'failed') {
                    clearInterval(intervalID);
                    job.params.taskFailures.push(detail);
                    return cb(new Error('Job "' + detail.job_uuid
                        + '" failed for server "' + detail.vm_uuid + '"'));
                }

                if (task.execution == 'succeeded') {
                    clearInterval(intervalID);
                    job.params.taskSuccesses.push(detail);
                    return cb(null);
                }
            });
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null, 'All VM update tasks returned successfully');
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
        name: 'napi.get_nics',
        timeout: 10,
        retry: 1,
        body: getNics
    }, {
        name: 'vmapi.get_vms',
        timeout: 10,
        retry: 1,
        body: getVMs
    }, {
        name: 'vmapi.update_resolvers',
        timeout: 10,
        retry: 1,
        body: updateResolvers
    }, {
        name: 'vmapi.poll_jobs',
        timeout: 120,
        retry: 1,
        body: pollJobs
    } ],
    timeout: 210,
    onerror: [ {
        name: 'On error',
        body: function (job, cb) {
            return cb('Error executing job');
        }
    } ]
};
