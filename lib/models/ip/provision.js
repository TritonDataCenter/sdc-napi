/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * ip model: provisioning functions for IPs on logical networks
 */

'use strict';

var assert = require('assert-plus');
var common = require('./common');
var constants = require('../../util/constants');
var errors = require('../../util/errors');
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
 * There is one IP bucket per network, named napi_ips_<network UUID>, as
 * per bucketName() below.  The key is on .ip, which is the integer
 * representation of the IP address (this is therefore a unique index). The
 * bucket is created with certain keys pre-populated. A diagram of these keys
 * sorted in ascending order looks like this:
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
 * Create opts.ip, and add its batch item to opts.batch
 */
function addIPtoBatch(opts) {
    if (opts.ipProvisionQueue[0].hasOwnProperty('ip')) {
        opts.ipParams.ip = opts.ipProvisionQueue[0].ip;
    }

    if (opts.ipProvisionQueue[0].hasOwnProperty('ipaddr')) {
        opts.ipParams.ipaddr = opts.ipProvisionQueue[0].ipaddr;
    }

    opts.ipParams.etag = opts.ipProvisionQueue[0].etag;
    opts.ip = new common.IP(opts.ipParams);
    opts.batch.push(opts.ip.batch());
}


/**
 * Get the next "gap" IPs (with no existing moray record, but in the subnet
 * range) from the network specified by opts.validated.network_uuid.
 */
function nextGapIPsOnNetwork(opts, callback) {
    var log = opts.log;
    var params = opts.validated;

    var bucket = common.getBucketObj(params.network_uuid);
    var maxGapLength = 100; // gap length could be bigger than javascript's max
                            // int, so cap it off on the postgres side before
                            // it gets to moray
    var min = util_ip.ipAddrMinus(params.network.provisionMin, 1);
    var max = util_ip.ipAddrPlus(params.network.provisionMax, 1);
    var gap;
    var sql = util.format('select * from ' +
        '(select ipaddr+1 gap_start, least(coalesce(lead(ipaddr) ' +
        'over(order by ipaddr) - ipaddr - 1, 0), %d) gap_length from %s ' +
        'where ipaddr >= inet(\'%s\') AND ipaddr <= inet(\'%s\')) t ' +
        'where gap_length > 0 limit 1',
            maxGapLength,
            bucket.name,
            min.toString(),
            max.toString());

    if (!params.network.ip_use_strings) {
        sql = util.format(
            'select * from (select ip+1 gap_start, lead(ip) ' +
            'over(order by ip) - ip - 1 gap_length from %s ' +
            'where ip >= %d AND ip <= %d) t where gap_length > 0 limit 1',
            bucket.name,
            util_ip.addressToNumber(min.toString()),
            util_ip.addressToNumber(max.toString()));
    }

    log.debug({
        tries: opts.ipProvisionTries,
        sql: sql,
        network_uuid: params.network_uuid
    }, 'nextGapIPsOnNetwork: finding gap IPs');

    var req = opts.app.moray.sql(sql);

    req.once('record', function (r) {
        log.debug({
            tries: opts.ipProvisionTries,
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

            opts.noMoreGapIPs = true;
            log.debug({
                network_uuid: params.network_uuid,
                tries: opts.ipProvisionTries
            }, 'nextGapIPsOnNetwork: no free gap IPs');

            return callback(freeErr);
        }

        if (!gap.hasOwnProperty('gap_start') ||
            !gap.hasOwnProperty('gap_length')) {
            var pgErr = new Error('Invalid record from moray');
            log.error({ err: pgErr, gap: gap, sql: sql },
                'Moray record missing required properties');
            return callback(pgErr);
        }

        for (var i = 0; i < gap.gap_length; i++) {
            opts.ipProvisionQueue.push({
                etag: null,
                ip: util_ip.ipAddrPlus(util_ip.toIPAddr(gap.gap_start), i)
            });
        }

        log.debug({
            network_uuid: params.network_uuid,
            tries: opts.ipProvisionTries,
            gap_start: gap.gap_start,
            gap_length: gap.gap_length,
            found: gap.gap_length - 1
        }, 'nextGapIPsOnNetwork: found gap IPs');

        return callback();
    });
}


/**
 * Get the next previously freed IPs (where the record exists in moray, but has
 * reserved=false and belongs_to_uuid=null) from the network in
 * opts.validated.network_uuid.
 */
function nextFreedIPsonNetwork(opts, callback) {
    var log = opts.log;
    var params = opts.validated;
    var bucket = common.getBucketObj(params.network_uuid);
    var filter =
        util.format(
            '(&(ipaddr>=%s)(ipaddr<=%s)(!(belongs_to_uuid=*))(reserved=false))',
            params.network.provisionMin.toString(),
            params.network.provisionMax.toString());
    var found = 0;

    if (!params.network.ip_use_strings) {
        filter = util.format(
            '(&(ip>=%d)(ip<=%d)(!(belongs_to_uuid=*))(reserved=false))',
            util_ip.addressToNumber(params.network.provisionMin.toString()),
            util_ip.addressToNumber(params.network.provisionMax.toString()));
    }

    log.debug({
        bucket: bucket.name,
        tries: opts.ipProvisionTries,
        filter: filter,
        network_uuid: params.network_uuid
    }, 'nextFreedIPsonNetwork: finding freed IPs');

    var req = opts.app.moray.findObjects(bucket.name, filter,
        { sort: { attribute: '_mtime', order: 'ASC' }, limit: 10 });

    req.once('error', function (err) {
        log.error(err, 'nextFreedIPsonNetwork: error');
        return callback(err);
    });

    req.on('record', function (obj) {
        found++;
        opts.ipProvisionQueue.push({ ip: obj.key, etag: obj._etag });
    });

    req.once('end', function () {
        if (found > 0) {
            log.debug({
                found: found,
                tries: opts.ipProvisionTries
            }, 'nextFreedIPsonNetwork: found freed IPs');
            return callback();
        }

        log.debug({ tries: opts.ipProvisionTries },
            'nextFreedIPsonNetwork: no freed IPs');

        var fullErr =
            new errors.SubnetFullError(constants.SUBNET_FULL_MSG);
        fullErr.stop = true;
        fullErr.context = bucket.name;

        return callback(fullErr);
    });
}



// --- Exports



/**
 * Get the next IP on the given network, store it in opts.ip, and add its
 * batch item to opts.batch.
 *
 * This is intended to be called repeatedly by the nic model's
 * provision.nicAndIP(). Calling callback with err.stop will therefore end
 * the provisioning loop.
 *
 * @param opts {Object}:
 * - ipParams {Object}: parameters used for creating the IP (required)
 */
function nextIPonNetwork(opts, callback) {
    // Try to provision an IP:
    // - If we've exceeded our tries, return stop err
    // - If we have an error, but it's not us, return queue[0] again
    // - If we have an error and it's us, unshift the queue
    // - If we have queue[0], return it
    // - Otherwise, get more IPs
    //   - If there are no more to get, return subnet full stop err

    assert.object(opts, 'opts');
    assert.object(opts.ipParams, 'opts.ipParams');

    if (!opts.hasOwnProperty('ipProvisionTries')) {
        opts.ipProvisionTries = 0;
    }

    if (!opts.ipProvisionQueue) {
        opts.ipProvisionQueue = [];
    }

    // We've exceeded the maximum number tries: return stop err
    if (opts.ipProvisionTries > constants.IP_PROVISION_RETRIES) {
        opts.log.error({ tries: constants.IP_PROVISION_RETRIES },
            'nextIPonNetwork: Exceeded IP provision retries');
        var tryErr = new
            errors.SubnetFullError(constants.SUBNET_FULL_MSG);
        tryErr.stop = true;

        return callback(tryErr);
    }

    var bucket = common.getBucketObj(opts.validated.network_uuid);

    if (opts.err) {
        if (opts.err.context && opts.err.context.bucket === bucket.name) {
            // The error was because the IP we picked last time was already
            // taken - remove it from the queue below
            opts.log.debug('nextIPonNetwork: previous error due to us');

        } else if (opts.ipProvisionQueue.length !== 0) {
            // The error wasn't due to us, so if we have an IP, return it again
            addIPtoBatch(opts);
            opts.log.debug({ ip: opts.ip.serialize(), bucket: bucket.name },
                'nextIPonNetwork: error not due to us: reusing IP');
            return callback();
        }
    }

    if (opts.ipProvisionQueue.length !== 0) {
        opts.ipProvisionQueue.shift();
    }

    if (opts.ipProvisionQueue.length !== 0) {
        // We still have an IP in the queue to try - no need to fetch more
        addIPtoBatch(opts);
        opts.ipProvisionTries++;

        opts.log.debug({
            next: opts.ip.serialize(),
            queueLength: opts.ipProvisionQueue.length,
            tries: opts.ipProvisionTries
        }, 'nextIPonNetwork: trying next IP in queue');
        return callback();
    }

    // There are no IPs left in the queue - try to get some more
    var selectionFn = nextGapIPsOnNetwork;
    // XXX: need to put stuff like opts.noMoreGapIPs in its own sub-object!
    if (opts.noMoreGapIPs) {
        selectionFn = nextFreedIPsonNetwork;
    }

    opts.log.debug('nextIPonNetwork: selecting IPs with %s', selectionFn.name);

    selectionFn(opts, function (err) {
        if (err) {
            opts.ipProvisionTries++;
            return callback(err);
        }

        opts.log.debug({
            next: opts.ipProvisionQueue[0],
            queueLength: opts.ipProvisionQueue.length,
            tries: opts.ipProvisionTries
        }, 'nextIPonNetwork: queue after %s', selectionFn.name);

        if (opts.noMoreGapIPs && opts.ipProvisionQueue.length === 0) {
            var fullErr = new
                errors.SubnetFullError(constants.SUBNET_FULL_MSG);
            fullErr.stop = true;
            fullErr.context = bucket.name;
            return callback(err);
        }

        if (opts.ipProvisionQueue.length === 0) {
            opts.log.error({ tries: opts.ipProvisionTries },
                'nextIPonNetwork: empty IP provision queue');
            var fallbackErr = new
                errors.SubnetFullError(constants.SUBNET_FULL_MSG);
            fallbackErr.stop = true;
            return callback(fallbackErr);
        }

        addIPtoBatch(opts);
        return callback();
    });
}


module.exports = {
    nextIPonNetwork: nextIPonNetwork
};
