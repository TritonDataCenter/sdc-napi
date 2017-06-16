/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * ip model: provisioning functions for IPs on logical networks
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var jsprim = require('jsprim');
var util = require('util');
var util_ip = require('../../util/ip.js');



/*
 * # IP buckets and provisioning
 *
 * "for all things that have a function or activity, the good and the well is
 * thought to reside in the function" - Aristotle, Nicomachean Ethics
 *
 * ## bucket structure
 *
 * There is one IP bucket per network, named napi_ips_<network UUID>, as per
 * bucketName() below. For older networks, the key is in .ip, which is the
 * integer representation of the IP address. Newer networks store it in .ipaddr,
 * which uses the Postgres INET type. These are both unique keys. The bucket is
 * created with certain keys pre-populated. A diagram of these keys sorted in
 * ascending order looks like this:
 *
 *   +--------------------------------------------------------+
 *   |   | GW |     | PS |                | PE |         | BR |
 *   +--------------------------------------------------------+
 *
 *   * GW: the gateway IP for that subnet - if the subnet has a gateway,
 *     this record will be reserved on creation.
 *   * BR: the broadcast address for that subnet - always reserved, since
 *     this isn't a usable IP.
 *   * PS: A placeholder record for (provision_start_ip - 1)
 *   * PE: A placeholder record for (provision_end_ip + 1)
 *
 * How PS and PE are used is explained in the "How nextGapIPsOnNetwork() works"
 * section below.
 *
 *
 * ## IP provisioning process
 *
 * The two guiding properties of the IP provision process are:
 *
 * 1) It should have a deterministic order, from lowest IP in the subnet
 *    to highest (if possible).  This makes it easy to test, easy for
 *    operators to guess what the subnet usage will look like, and makes gap
 *    detection much easier (explained in the "How nextGapIPsOnNetwork() works"
 *    section below).
 *
 * 2) For IP records that are freed (eg: a record that was provisioned, but
 *    is no longer needed and returned to the pool), we should pick the
 *    one freed the longest time ago.  This is mostly to prevent a lot of
 *    churn in ARP tables on switches - if we were to pick the most recently
 *    used one, repeated provisioning and deprovisioning of an IP would cause
 *    a lot of updates to the ARP records for that IP.
 *
 *
 * Those two properties lead to a provisioning process as follows:
 *
 * 1) Try to find a free IP that has never been used before (this is
 *    nextGapIPsOnNetwork() below).
 *
 * 2) If there are no never-used IPs, return the one that was freed the
 *    longest time ago (this is nextFreedIPsonNetwork() below).
 *
 * 3) If there are no freed IPs left, the subnet is full.
 *
 * Note that if we are requesting a specific IP, the provisioning process
 * is skipped - we just try to add the IP record, or update it with the
 * new owner if it does not exist.  If the record is already taken, this
 * process returns an error.
 *
 *
 * ## How nextGapIPsOnNetwork() works
 *
 * nextGapIPsOnNetwork() abuses the fact that moray is implemented on top of
 * Postgres, and that you can run arbitrary SQL against it using .sql().
 *
 * nextGapIPsOnNetwork() uses Postgres' lead() window function to search for
 * gaps in the values of the ip column for the napi_ips_<uuid> bucket for a
 * network.  For example, say that you have the following records in the
 * PG table for that bucket (these are not real IP numbers, and what's in
 * the _key and _value columns is not important):
 *
 *   | ip | _key | _value |
 *   +----+------+--------+
 *   | 3  | ...  | ...    |
 *   | 4  | ...  | ...    |
 *   | 5  | ...  | ...    |  \  first
 *   | 9  | ...  | ...    |  /   gap
 *   | 10 | ...  | ...    |  \  second
 *   | 14 | ...  | ...    |  /   gap
 *
 * lead() will find 2 gaps here (values for ip that don't yet exist in the
 * table).  It will return a gap_start value of 6 for the first gap, and 11
 * for the second.
 *
 * nextGapIPsOnNetwork() tries up to 10 times to find a new gap_start, and then
 * tries to do a put of that record to moray with a null _etag value.  This
 * will cause moray to return an error if that record is already present.
 * This is meant to handle multiple NAPIs writing to the same record at the
 * same time.
 *
 * The placeholder records PS and PE are put on either side of the provision
 * range:
 *
 *   * PS = provision_start_ip - 1
 *   * PE = provision_end_ip + 1
 *
 * PG's gap detection requires these records in order to find gaps, but it
 * will only return values for gap_start that aren't in the table yet.  If
 * provision_start_ip and provision_end_ip were present instead, those records
 * would never be picked as gap_start, and would therefore be provisioned last
 * (see the next section).
 *
 *
 * ## How nextFreedIPsonNetwork() works
 *
 * First off, when an IP is deprovisioned, deleteIP() does not remove the
 * record from moray.  It just replaces the record with a value that has
 * reserved: false, and no other values.  This ensures that
 * nextGapIPsOnNetwork() can still continue to find gaps in the IP range
 * efficiently.
 *
 * Therefore, to find freed records, all we need to do is find records in
 * moray that have reserved=false and no belongs_to_uuid.  Sorting by
 * modification time takes care of using the records that were freed the
 * longest time ago.
 *
 * As with nextGapIPsOnNetwork(), we retrieve up to 10 records, trying a put on
 * each in order with _etag set, to handle multiple NAPIs trying to claim
 * the same record.
 *
 *
 * ## IP record life cycle
 *
 * The Boss said it best:
 *
 * "Everything dies, baby, that's a fact.  But maybe everything that dies
 * someday comes back" - Bruce Springsteen, Atlantic City
 *
 * An IP address in NAPI moves between the various states in the following
 * diagram. Note that it never returns to the "no record in moray" state.
 * The IP moves through the addIP() and updateIP() paths when we are
 * requesting a specific IP.  It moves through the nextGapIPsOnNetwork() and
 * nextFreedIPsonNetwork() paths when we don't care about which IP a VM gets -
 * we just want to provision an IP on the network.
 *
 *
 *                              +-------------+
 *                              |             |
 *                              |  no record  |
 *            +-------<---------+  in moray   |
 *            |                 |             |
 *            |                 +-------------+
 *            |                        |
 *            |                        |
 *            |                        |
 *         createIP()         nextGapIPsOnNetwork()
 *            |                        |
 *            |                        |
 *            |                        |
 *            |                        v
 *            |           +--------------------------+
 *            |           |                          |
 *            +---------->|       provisioned        |<-----------+
 *            |           | (record exists in moray) |            |
 *            |           |                          |            |
 *            |           +--------------------------+            |
 *            |                        |                          |
 *            |                        |                          |
 *            |                        |                          |
 *        updateIP()               deleteIP()         nextFreedIPsonNetwork()
 *            |                        |                          |
 *            |                        |                          |
 *            |                        |                          |
 *            |                        v                          |
 *            |                   +---------+                     |
 *            |                   |         |                     |
 *            +--------<----------+  freed  +-------->------------+
 *                                |         |
 *                                +---------+
 *
 */



// --- Internal

/**
 * Gap length could be bigger than JavaScript's max int, so
 * cap it off on the Postgres side before it gets to Moray.
 */
var MAX_GAP_LENGTH = 100;

var GAP_IP_STR_SQL = util.format(
    'SELECT * FROM (SELECT ipaddr+1 gap_start, least(coalesce(lead(ipaddr) ' +
    'OVER (ORDER BY ipaddr) - ipaddr - 1, 0), %d) gap_length FROM %%s ' +
    'WHERE ipaddr >= $1 AND ipaddr <= $2) t ' +
    'WHERE gap_length > 0 LIMIT 1', MAX_GAP_LENGTH);

var GAP_IP_NUM_SQL =
    'SELECT * FROM (SELECT ip+1 gap_start, lead(ip) ' +
    'OVER (ORDER BY ip) - ip - 1 gap_length FROM %s ' +
    'WHERE ip >= $1 AND ip <= $2) t WHERE gap_length > 0 LIMIT 1';

function ProvisionInfo(baseParams, network) {
    this.params = baseParams;
    this.network = network;
    this.tries = 0;
    this.noMoreGapIPs = false;
    this.queue = [];

    Object.seal(this);
}


/**
 * Construct a new IP object using the next queued address.
 */
ProvisionInfo.prototype.shift = function getNextIP() {
    var nextIP = this.queue.shift();

    assert.ok(nextIP, 'nextIP');
    assert.ok(nextIP.ip, 'nextIP.ip');

    var params = jsprim.deepCopy(this.params);

    params.network = this.network;
    params.network_uuid = this.network.uuid;

    params.etag = nextIP.etag;
    params.ip = nextIP.ip;

    return new common.IP(params);
};


/**
 * Get the next "gap" IPs (with no existing moray record, but in the subnet
 * range) from the specified network.
 */
function nextGapIPsOnNetwork(opts, network, callback) {
    var log = opts.log;

    var provinfo = opts.ipProvisions[network.uuid];

    var bucket = common.bucketName(network.uuid);
    var min = util_ip.ipAddrMinus(network.provisionMin, 1);
    var max = util_ip.ipAddrPlus(network.provisionMax, 1);
    var gap, sql, args;

    if (network.ip_use_strings) {
        sql = util.format(GAP_IP_STR_SQL, bucket);
        args = [ min.toString(), max.toString() ];
    } else {
        sql = util.format(GAP_IP_NUM_SQL, bucket);
        args = [ min.toLong(), max.toLong() ];
    }

    log.debug({
        tries: provinfo.tries,
        sql: sql,
        args: args,
        network_uuid: network.uuid
    }, 'nextGapIPsOnNetwork: finding gap IPs');

    var req = opts.app.moray.sql(sql, args);

    req.once('record', function (r) {
        log.debug({
            tries: provinfo.tries,
            rec: r
        }, 'nextGapIPsOnNetwork: gap data');

        if (r) {
            gap = r;
        }
    });

    req.once('error', function (err) {
        log.error(err, 'nextGapIPsOnNetwork: error');
        return callback(err);
    });

    req.once('end', function () {
        if (!gap) {
            // No gap found, so no sense in trying over and over
            var freeErr = new Error('No free gap IPs');
            freeErr.noFreeIPs = true;

            provinfo.noMoreGapIPs = true;
            log.debug({
                network_uuid: network.uuid,
                tries: provinfo.tries
            }, 'nextGapIPsOnNetwork: no free gap IPs');

            callback(freeErr);
            return;
        }

        if (!gap.hasOwnProperty('gap_start') ||
            !gap.hasOwnProperty('gap_length')) {
            var pgErr = new Error('Invalid record from moray');
            log.error({ err: pgErr, gap: gap, sql: sql },
                'Moray record missing required properties');
            callback(pgErr);
            return;
        }

        for (var i = 0; i < gap.gap_length; i++) {
            provinfo.queue.push({
                etag: null,
                ip: util_ip.ipAddrPlus(util_ip.toIPAddr(gap.gap_start), i)
            });
        }

        log.debug({
            network_uuid: network.uuid,
            tries: provinfo.tries,
            gap_start: gap.gap_start,
            gap_length: gap.gap_length,
            found: gap.gap_length - 1
        }, 'nextGapIPsOnNetwork: found gap IPs');

        callback();
    });
}


/**
 * Get the next previously freed IPs (where the record exists in Moray, but has
 * reserved=false and belongs_to_uuid=null) from the specified network.
 */
function nextFreedIPsonNetwork(opts, network, callback) {
    var log = opts.log;
    var bucket = common.bucketName(network.uuid);
    var filter =
        util.format(
            '(&(ipaddr>=%s)(ipaddr<=%s)(!(belongs_to_uuid=*))(reserved=false))',
            network.provisionMin.toString(),
            network.provisionMax.toString());
    var found = 0;

    var provinfo = opts.ipProvisions[network.uuid];

    if (!network.ip_use_strings) {
        filter = util.format(
            '(&(ip>=%d)(ip<=%d)(!(belongs_to_uuid=*))(reserved=false))',
            network.provisionMin.toLong(),
            network.provisionMax.toLong());
    }

    log.debug({
        bucket: bucket,
        tries: provinfo.tries,
        filter: filter,
        network_uuid: network.uuid
    }, 'nextFreedIPsonNetwork: finding freed IPs');

    var req = opts.app.moray.findObjects(bucket, filter,
        { sort: { attribute: '_mtime', order: 'ASC' }, limit: 10 });

    req.once('error', function (err) {
        log.error(err, 'nextFreedIPsonNetwork: error');
        return callback(err);
    });

    req.on('record', function (obj) {
        found++;
        provinfo.queue.push({ ip: obj.key, etag: obj._etag });
    });

    req.once('end', function () {
        if (found > 0) {
            log.debug({
                found: found,
                tries: provinfo.tries
            }, 'nextFreedIPsonNetwork: found freed IPs');
            callback();
            return;
        }

        log.debug({ tries: provinfo.tries },
            'nextFreedIPsonNetwork: no freed IPs');

        callback(new errors.SubnetFullError(network.uuid));
    });
}



// --- Exports



/**
 * Try to provision an IP:
 * - If we've exceeded our tries, return stop error.
 * - If we have items in our queue, remove and return the first one
 *   via the callback.
 * - Otherwise, get more IPs.
 * - If there are no more to get, return a SubnetFullError with stop=true.
 *
 * This is intended to be called repeatedly by the NIC model's
 * Provisioners, which implement provisioning for different scenarios.
 * Calling the callback here with an error containing stop=true will
 * therefore end the provisioning loop.
 *
 * @param opts {Object}:
 * - baseParams {Object}: parameters used for creating the IP (required).
 * @param network {Network}: The network to fetch the next IP for.
 * @param callback {Function}
 */
function nextIPonNetwork(opts, network, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.baseParams, 'opts.baseParams');

    opts.log.debug('nextIPonNetwork: attempting IP allocation on %s network %s',
        network.family, network.uuid);

    if (!opts.ipProvisions) {
        opts.ipProvisions = {};
    }

    if (!opts.ipProvisions[network.uuid]) {
        opts.ipProvisions[network.uuid] =
            new ProvisionInfo(opts.baseParams, network);
    }

    var provinfo = opts.ipProvisions[network.uuid];

    // We've exceeded the maximum number of tries: return stop err
    if (provinfo.tries > constants.IP_PROVISION_RETRIES) {
        opts.log.error({ tries: constants.IP_PROVISION_RETRIES },
            'nextIPonNetwork: Exceeded IP provision retries');
        callback(new errors.SubnetFullError(network.uuid));
        return;
    }

    if (provinfo.queue.length !== 0) {
        // We still have an IP in the queue to try - no need to fetch more
        var next = provinfo.shift();
        provinfo.tries++;

        opts.log.debug({
            next: next,
            queueLength: provinfo.queue.length,
            tries: provinfo.tries
        }, 'nextIPonNetwork: trying next IP in queue');
        callback(null, next);
        return;
    }

    // There are no IPs left in the queue - try to get some more
    var selectionFn = nextGapIPsOnNetwork;
    if (provinfo.noMoreGapIPs) {
        selectionFn = nextFreedIPsonNetwork;
    }

    opts.log.debug('nextIPonNetwork: selecting IPs with %s', selectionFn.name);

    selectionFn(opts, network, function (err) {
        if (err) {
            provinfo.tries++;
            callback(err);
            return;
        }

        opts.log.debug({
            next: provinfo.queue[0],
            queueLength: provinfo.queue.length,
            tries: provinfo.tries
        }, 'nextIPonNetwork: queue after %s', selectionFn.name);

        callback(null, provinfo.shift());
    });
}


module.exports = {
    nextIPonNetwork: nextIPonNetwork
};
