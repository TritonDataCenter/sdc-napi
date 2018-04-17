/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * nic model: provisioning functions for nics and IPs
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var mod_ip = require('../ip');
var mod_portolan_moray = require('portolan-moray');
var Nic = require('./obj').Nic;
var restify = require('restify');
var util = require('util');
var util_common = require('../../util/common');
var util_oui = require('../../util/oui');
var vasync = require('vasync');
var VError = require('verror');



// --- Internal functions


/**
 * If we have an existing NIC and it has provisioned IP addresses,
 * check if it contains any addresses that we're no longer using,
 * and free them.
 */
function freeOldIPs(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    if (!opts._removeIPs) {
        callback();
        return;
    }

    assert.object(opts.existingNic, 'opts.existingNic');

    var mac = opts.existingNic.mac.toLong();
    var cn_uuid = opts.existingNic.params.cn_uuid;

    opts._removeIPs.forEach(function addUnassignToBatch(oldIP) {
        opts.batch.push(oldIP.unassignBatch());
    });

    /*
     * If we're on a fabric NIC, then we need to update the Portolan entry for
     * the IPs to mark them as deleted, and generate the appropriate VL3
     * shootdowns, to indicate that they aren't mapped to the same NIC anymore.
     */
    if (opts.existingNic.isFabric()) {
        opts._removeIPs.forEach(function shootdownIP(oldIP) {
            var vlan_id = oldIP.params.network.params.vlan_id;
            var vnet_id = oldIP.params.network.params.vnet_id;
            var v6addr = oldIP.v6address;

            var vl3batch = mod_portolan_moray.vl3CnEventBatch({
                vnetCns: opts.vnetCns,
                vnet_id: vnet_id,
                ip: v6addr,
                mac: mac,
                vlan_id: vlan_id
            });

            vl3batch.push(mod_portolan_moray.overlayMappingBatch({
                cn_uuid: cn_uuid,
                deleted: true,
                ip: v6addr,
                mac: mac,
                vnet_id: vnet_id
            }));

            opts.batch = opts.batch.concat(vl3batch);
        });
    }

    callback();
}


/**
 * Base Provisioner Class
 *
 * When provisioning a NIC, there are multiple strategies used to determine what
 * addresses the NIC ends up with. The logic for each of these strategies is in
 * a different class that extends this one.
 *
 * Each strategy must define a .provision(opts, callback) method, which will be
 * called on each attempt to update Moray. When an attempt has failed, opts.err
 * will be set to the failure reason. The strategy should check to see if the
 * parameters that it had selected were the cause of the failure. If so, then it
 * should either abort or select a new address as appropriate.
 *
 * If its parameters and selected address are still okay, then it should call
 * the .batchIP(opts, callback) method to reinsert the address, and continue.
 */
function Provisioner() {
    throw new Error('Provisioner should never be instantiated');
}


/**
 * Intersections are only used when provisioning an address on a network pool.
 * This base method is only used by non-pool provisioning strategies and is
 * effectively a no-op, but we do take the opportunity to assert that the
 * network is valid with the intersection.
 *
 * See lib/util/intersect.js for more information on intersections and what
 * fields are checked here.
 */
Provisioner.prototype.setIntersection =
    function validIntersection(intersection) {
    assert.ok(this.network, 'network selected');
    assert.ok(this.network.matches(intersection), 'valid under intersection');
};


/**
 * Grab the next available IP address on the currently selected network.
 *
 * @param opts {Object}:
 * - baseParams {Object}: parameters used for creating the IP (required).
 * @param dontStop {Boolean}: Whether to ignore stopping errors. Useful for
 *   network pools which move onto the next network in the pool when one is
 *   full.
 * @param callback {Function}: Callback to use once an IP has been fetched
 *   and added to the Moray batch.
 */
Provisioner.prototype.fetchNextIP =
    function fetchNextIP(opts, dontStop, callback) {
    var self = this;
    assert.object(self.network, 'Network selected');
    mod_ip.nextIPonNetwork(opts, self.network, function saveFetchedIP(err, ip) {
        if (err) {
            if (dontStop && err.stop) {
                delete err.stop;
            }
            callback(err);
            return;
        }

        self.ip = ip;
        self.batchIP(opts, callback);
    });
};


/**
 * Push the selected IP address and its batched form into nicAndIP's arrays.
 */
Provisioner.prototype.batchIP = function batchCurIP(opts, callback) {
    assert.ok(this.ip, 'IP selected');
    opts.ips.push(this.ip);
    opts.batch.push(this.ip.batch());
    callback();
};


/**
 * If there was a previous error, check if it was because of our chosen IP.
 */
Provisioner.prototype.causedEtagFailure = function causedEtagFailure(err) {
    if (!err) {
        // No error yet.
        return false;
    }

    if (this.ip === null) {
        // We haven't selected an IP yet.
        return false;
    }

    var cause = VError.findCauseByName(err, 'EtagConflictError');
    if (cause === null) {
        return false;
    }

    var key = this.ip.key();
    var bucket = mod_ip.bucketName(this.network.uuid);
    return (cause.context.bucket === bucket && cause.context.key === key);
};


/**
 * Provisioner for handling specifically requested IP addresses.
 */
function IPProvision(ip, field) {
    this.ip = ip;
    this.network = ip.params.network;
    this.field = field;

    Object.seal(this);
}
util.inherits(IPProvision, Provisioner);


IPProvision.prototype.provision = function provisionIP(opts, callback) {
    if (this.causedEtagFailure(opts.err)) {
        var usedIP = this.ip.address.toString();
        var usedNet = this.network.uuid;
        var usedMsg = util.format(constants.fmt.IP_EXISTS, usedIP, usedNet);
        var usedErr = new errors.InvalidParamsError(
            constants.msg.INVALID_PARAMS,
            [ errors.duplicateParam(this.field, usedMsg) ]);
        usedErr.stop = true;
        callback(usedErr);
    } else {
        this.batchIP(opts, callback);
    }
};


/**
 * Provisioner for finding available IPs on requested networks.
 */
function NetworkProvision(network) {
    assert.object(network, 'network');

    this.ip = null;
    this.network = network;

    Object.seal(this);
}
util.inherits(NetworkProvision, Provisioner);


NetworkProvision.prototype.provision = function provisionNet(opts, callback) {
    if (this.ip === null || this.causedEtagFailure(opts.err)) {
        // We haven't chosen an IP yet, or the previous one was taken
        // by someone else.
        this.fetchNextIP(opts, false, callback);
    } else {
        // Reuse the already selected IP.
        this.batchIP(opts, callback);
    }
};


/**
 * Provisioner for finding IPs on networks in a given pool.
 */
function NetworkPoolProvision(pool, field) {
    assert.object(pool, 'pool');
    assert.string(field, 'field');

    this.ip = null;
    this.network = null;
    this.networks = null;
    this.intersection = null;

    this.pool = pool;
    this.field = field;

    Object.seal(this);
}
util.inherits(NetworkPoolProvision, Provisioner);


/**
 * Reset the Provisioner to use a new subset of the networks.
 */
NetworkPoolProvision.prototype.setIntersection =
    function setNewIntersection(intersection) {
    this.ip = null;
    this.network = null;
    this.networks = null;
    this.intersection = intersection;
};



/**
 * Move on to the next network in the pool, and provision an IP from it.
 */
NetworkPoolProvision.prototype.nextNetwork =
    function nextNetworkPool(opts, callback) {
    var self = this;

    if (self.networks === null) {
        assert.object(self.intersection, 'intersection set');
        self.networks = self.pool.networks.filter(function (network) {
            return network.matches(self.intersection);
        });
        assert.ok(self.networks.length > 0, 'networks available');
    } else if (self.networks.length === 0) {
        callback(new errors.PoolFullError(self.field, self.pool.uuid));
        return;
    }

    var next = self.networks.shift();

    opts.log.debug({ nextUUID: next.uuid }, 'Trying next network in pool');

    self.network = next;
    self.fetchNextIP(opts, true, callback);
};


/**
 * Check if we've failed a provision on the currently selected network.
 */
NetworkPoolProvision.prototype.currentNetFailed =
    function currentNetFailed(err) {
    if (!err) {
        // No error yet.
        return false;
    }

    if (err.name !== 'SubnetFullError') {
        return false;
    }

    return (err.network_uuid === this.network.uuid);
};


NetworkPoolProvision.prototype.provision =
    function provisionPool(opts, callback) {

    if (this.network === null || this.currentNetFailed(opts.err)) {
        // We haven't selected a network, or the chosen one is full.
        this.nextNetwork(opts, callback);
    } else if (this.ip === null || this.causedEtagFailure(opts.err)) {
        // Our selected IP has been taken: pick another
        this.fetchNextIP(opts, true, callback);
    } else {
        // Our current selection is fine, try it again
        this.batchIP(opts, callback);
    }
};


/**
 * Test if we've failed to provision a new NIC due to a conflict in MAC address.
 */
function nicEtagFail(err) {
    if (!err) {
        return false;
    }

    var cause = VError.findCauseByName(err, 'EtagConflictError');
    if (cause === null) {
        return false;
    }

    return (cause.context.bucket === common.BUCKET.name);
}


/**
 * Adds an opts.nic with the MAC address from opts.validated, and adds its
 * batch item to opts.batch.  Intended to be passed to nicAndIP() in
 * opts.nicFn.
 */
function macSupplied(opts, callback) {
    // We've already tried provisioning once, and it was the nic that failed:
    // no sense in retrying

    opts.log.debug({}, 'macSupplied: enter');

    if (opts.nic && nicEtagFail(opts.err)) {
        var usedErr = new errors.InvalidParamsError(
            constants.msg.INVALID_PARAMS, [ errors.duplicateParam('mac') ]);
        usedErr.stop = true;
        callback(usedErr);
        return;
    }

    opts.nic = new Nic(opts.validated);
    if (opts.ips.length > 0) {
        assert.equal(opts.ips.length, 1, 'opts.ips.length === 1');
        opts.nic.ip = opts.ips[0];
        opts.nic.network = opts.nic.ip.params.network;
    }

    callback();
}


/**
 * Adds an opts.nic with a random MAC address, and adds its batch item to
 * opts.batch.  Intended to be passed to nicAndIP() in opts.nicFn.
 */
function randomMAC(opts, callback) {
    var validated = opts.validated;

    if (!opts.hasOwnProperty('macTries')) {
        opts.macTries = 0;
    }

    opts.log.debug({ tries: opts.macTries }, 'randomMAC: entry');

    // If we've already supplied a MAC address and the error isn't for our
    // bucket, we don't need to generate a new MAC - just re-add the existing
    // NIC to the batch.
    if (validated.mac && !nicEtagFail(opts.err)) {
        opts.nic = new Nic(validated);
        if (opts.ips.length > 0) {
            assert.equal(opts.ips.length, 1, 'opts.ips.length === 1');
            opts.nic.ip = opts.ips[0];
            opts.nic.network = opts.nic.ip.params.network;
        }

        callback();
        return;
    }

    if (opts.macTries > constants.MAC_RETRIES) {
        opts.log.error({
            start: opts.startMac,
            num: validated.mac,
            tries: opts.macTries
        }, 'Could not provision nic after %d tries', opts.macTries);
        var err = new restify.InternalError('no more free MAC addresses');
        err.stop = true;
        callback(err);
        return;
    }

    opts.macTries++;

    if (!opts.maxMac) {
        opts.maxMac = util_oui.maxOUInum(opts.app.config.macOUI);
    }

    if (!validated.mac) {
        validated.mac = util_oui.randomNum(opts.app.config.macOUI);
        opts.startMac = validated.mac;
    } else {
        validated.mac++;
    }

    if (validated.mac > opts.maxMac) {
        /*
         * We've gone over the maximum MAC number - start from a
         * different random number.
         */
        validated.mac = util_oui.randomNum(opts.app.config.macOUI);
    }

    opts.nic = new Nic(validated);
    if (opts.ips.length > 0) {
        assert.equal(opts.ips.length, 1, 'opts.ips.length === 1');
        opts.nic.ip = opts.ips[0];
        opts.nic.network = opts.nic.ip.params.network;
    }

    opts.log.debug({}, 'randomMAC: exit');
    callback();
}



// --- Exported functions



/**
 * Adds parameters to opts for provisioning a nic and an optional IP
 */
function addParams(opts, callback) {
    opts.nicFn = opts.validated.mac ? macSupplied : randomMAC;
    opts.baseParams = mod_ip.params(opts.validated);

    opts.validated.created_timestamp = Date.now();
    opts.validated.modified_timestamp = opts.validated.created_timestamp;

    callback();
}

/**
 * Add the batch item for the nic in opts.nic opts.batch, as well as an
 * item for unsetting other primaries owned by the same owner, if required.
 */
function nicBatch(opts, callback) {
    assert.object(opts, 'opts');
    assert.func(callback, 'callback');

    opts.log.debug({
        vnetCns: opts.vnetCns,
        ip: opts.nic.ip ? opts.nic.ip.v6address : 'none'
    }, 'nicBatch: entry');

    opts.batch = opts.batch.concat(opts.nic.batch({
        log: opts.log,
        vnetCns: opts.vnetCns
    }));

    if (opts.shootdownNIC) {
        assert.object(opts.existingNic, 'opts.existingNic');
        assert.ok(opts.existingNic.isFabric(), 'opts.existingNic.isFabric()');

        opts.batch = opts.batch.concat(mod_portolan_moray.vl2CnEventBatch({
            log: opts.log,
            vnetCns: opts.vnetCns,
            vnet_id: opts.existingNic.network.vnet_id,
            mac: opts.existingNic.mac.toLong()
        }));
    }

    opts.log.debug({ batch: opts.batch }, 'nicBatch: exit');

    callback();
}


/**
 * If the network provided is a fabric network, fetch the list of CNs also
 * on that fabric network, for the purpose of SVP log generation.
 */
function listVnetCns(opts, callback) {
    assert.array(opts.ips, 'ips');

    // We aren't on any fabric networks.
    if (opts.ips.length === 0 || !opts.ips[0].isFabric()) {
        callback(null);
        return;
    }

    var listOpts = {
        moray: opts.app.moray,
        log: opts.log,
        vnet_id: opts.ips[0].params.network.vnet_id
    };

    common.listVnetCns(listOpts, function saveCNs(listErr, vnetCns) {
        if (listErr) {
            callback(listErr);
            return;
        }

        opts.log.debug({ vnetCns: vnetCns }, 'provision.listVnetCns exit');
        opts.vnetCns = vnetCns;
        callback(null);
    });
}


/**
 * Reset the chosen intersection for every Provisioner.
 */
function resetIntersections(provisioners, intersection) {
    provisioners.forEach(function (provisioner) {
        provisioner.setIntersection(intersection);
    });
}


/**
 * Run all of the IP Provisioners for this NIC provision.
 */
function runProvisions(opts, callback) {
    assert.object(opts, 'opts');
    assert.array(opts.provisioners, 'opts.provisioners');
    assert.func(callback, 'callback');

    var provisioners = opts.provisioners;
    var intersections = opts.validated.intersections;

    /*
     * If any intersections are present and we haven't yet selected one, then
     * initialize the Provisioners to use the first one.
     */
    if (intersections && !opts.intersection) {
        assert.ok(intersections.length > 0, 'have intersections');
        opts.intersection = intersections.shift();
        resetIntersections(provisioners, opts.intersection);
    }

    /*
     * If a pool is full, grab the next intersection and update everyone to
     * use it. If there are none left, there's nothing more we can do, so we
     * abort the provision attempt.
     */
    if (opts.err instanceof errors.PoolFullError) {
        opts.intersection = intersections.shift();
        if (!opts.intersection) {
            opts.err.stop = true;
            callback(opts.err);
            return;
        }
        resetIntersections(provisioners, opts.intersection);
    }

    /*
     * By this point, all of the Provisioners should be ready to attempt to
     * select an address. We run each one until each has either selected an
     * address, or we hit an error.
     */
    vasync.forEachPipeline({
        inputs: provisioners,
        func: function (provisioner, cb) {
            provisioner.provision(opts, cb);
        }
    }, callback);
}


/**
 * Provisions a NIC and optional IPs. This code uses Moray etags on each object
 * it creates/updates inside its .batch() to avoid conflicting with concurrent
 * requests. If a conflict occurs, the provision attempt is restarted, and new
 * IPs or MAC addresses selected as needed.
 *
 * @param opts {Object}:
 * - baseParams {Object}: parameters used for creating the IP
 * - nicFn {Function}: function that populates opts.nic
 */
function nicAndIP(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.baseParams, 'opts.baseParams');
    assert.func(opts.nicFn, 'opts.nicFn');
    assert.func(callback, 'callback');

    var retries = 0;
    var params = opts.validated;

    opts.provisioners = [];

    if (params._ip) {
        // Want a specific IP
        var updated = mod_ip.createUpdated(params._ip, opts.baseParams);
        opts.provisioners.push(new IPProvision(updated, 'ip'));
    } else if (params.network_pool) {
        opts.provisioners.push(
            new NetworkPoolProvision(params.network_pool, 'network_uuid'));
    } else if (params.network) {
        // Just provision the next IP on the network
        opts.provisioners.push(
            new NetworkProvision(params.network, 'network_uuid'));
    }

    opts.log.debug({
        nicProvFn: opts.nicFn.name,
        ipProvCount: opts.provisioners.length,
        baseParams: opts.baseParams,
        validated: opts.validated,
        vnetCns: opts.vnetCns || 'none'
    }, 'provisioning nicAndIP');

    util_common.repeat(function (cb) {
        // Reset opts.{batch,ips} - it is the responsibility for functions in
        // the pipeline to re-add their batch data each time through the loop.
        opts.batch = [];
        opts.ips = [];

        vasync.pipeline({
            arg: opts,
            funcs: [
                // 1. Determine what IPs to provision and batch them.
                runProvisions,

                // 2. Locate the CNs we need to inform of overlay IP changes.
                listVnetCns,

                // 3. Free any addresses we no longer need.
                freeOldIPs,

                // 4. Using our IPs, create the NIC object.
                opts.nicFn,

                // 5. Batch the NIC.
                nicBatch,

                // 6. Commit everything in our batch.
                common.commitBatch
            ]
        }, function (err) {
            if (err) {
                opts.log.warn({ err: err, final: err.stop }, 'error in repeat');
                if (err.stop || retries > constants.NIC_PROVISION_RETRIES) {
                    // No more to be done:
                    cb(err, null, false);
                    return;
                }

                /*
                 * Unfortunately we don't have a great way to classify errors
                 * here, so we can't really tell what's fatal/non-fatal. Most
                 * errors are non-fatal (EtagConflictErrors, errors connecting
                 * to Moray, Moray errors connecting to Postgres, etc.), so we
                 * retry. We limit the number of retries that we do so that we
                 * not only eventually terminate, but also avoid running up the
                 * Postgres sequence that Moray uses on each bucket.
                 */
                retries += 1;

                /*
                 * Save the error so that the pipeline functions can determine
                 * if they need to select new values for the provision.
                 */
                opts.err = err;

                cb(null, null, true);
                return;
            }

            cb(null, opts.nic, false);
        });
    }, function (err, res) {
        if (err) {
            callback(err);
            return;
        }

        opts.log.info({
            params: opts.params,
            obj: res.serialize()
        }, 'Created nic');

        callback(null, res);
    });
}

module.exports = {
    addParams: addParams,
    nicAndIP: nicAndIP
};
