/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * network model and related functions
 */

var assert = require('assert');
var clone = require('clone');
var constants = require('../util/constants');
var errors = require('../util/errors');
var ipaddr = require('ipaddr.js');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_subnet = require('../util/subnet');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');
/*
 * Circular dependencies required at end of file.
 * var mod_network = require('./network');
 */


/*
 * # network bucket structure
 *
 *
 * Each network in NAPI has the following data associated with it:
 *
 * 1) An entry in the napi_networks bucket (schema defined by BUCKET below).
 *    Each object in that bucket represents a different network.
 *
 * 2) A napi_ips_<uuid> bucket, that holds all of the IP records for that
 *    network (see bucketName() in models/ip.js).  There is one of these
 *    buckets per network.  For more information about how those buckets are
 *    structured, see the big theory statement at the top of models/ip.js.
 */



// --- Globals



var BUCKET = {
    desc: 'network',
    name: 'napi_networks',
    schema: {
        index: {
            name: { type: 'string', unique: true },
            nic_tag: { type: 'string' },
            owner_uuids: { type: 'string' },
            subnet: { type: 'subnet' },
            subnet_start_ip: { type: 'ip' },
            uuid: { type: 'string', unique: true },
            v: { type: 'number' },
            vlan_id: { type: 'number' },
            virtual: { type: 'boolean' },
            mtu: { type: 'number' }
        }
    },
    migrationVersion: 3,    // must be > version
    version: 2
};

var BUCKET_V1 = {
    desc: 'network',
    name: 'napi_networks',
    schema: {
        index: {
            name: { type: 'string', unique: true },
            nic_tag: { type: 'string' },
            owner_uuids: { type: 'string' },
            subnet_end_ip: { type: 'number' },
            subnet_start_ip: { type: 'number' },
            uuid: { type: 'string', unique: true },
            v: { type: 'number' },
            vlan_id: { type: 'number' }
        }
    },
    migrationVersion: 2,    // must be > version
    version: 1
};



// --- Internal helpers



/**
 * Returns parameters for creating an IP: reserved, belongs to admin,
 * type 'other'
 */
function adminReservedIP(network, ipNum, ufdsAdminUuid, legacy) {
    // XXX LEGACY: remove this after migration is complete
    if (legacy) {
        return {
            belongs_to_type: 'other',
            belongs_to_uuid: ufdsAdminUuid,
            ip: util_ip.addressToNumber(ipNum.toString()),
            network_uuid: network.params.uuid,
            owner_uuid: ufdsAdminUuid,
            reserved: true
        };
    }

    return {
        belongs_to_type: 'other',
        belongs_to_uuid: ufdsAdminUuid,
        ip: ipNum.toString(),
        network_uuid: network.params.uuid,
        owner_uuid: ufdsAdminUuid,
        reserved: true
    };
}


/**
 * Returns a placeholder IP record - one that's not reserved or taken by
 * anything, but still exists in moray for gap detection purposes
 */
function placeholderIP(num, legacy) {
    // XXX LEGACY: remove this after migration is complete
    if (legacy) {
        return { ip: util_ip.addressToNumber(num.toString()), reserved: false };
    }
    return { ip : num.toString(), reserved: false };
}


/**
 * Determines records that need to be added to moray based on changes to
 * provision_start_ip and provision_end_ip
 *
 * @param app {App}
 * @param log {Bunyan Logger}
 * @param update {Object}:
 * - `provision_start_ip` {Number}: provision range start (optional)
 * - `provision_end_ip` {Number}: provision range end (optional)
 * @param callback {Function} `function (err, batch)`
 * - Where batch is either null or an array suitable for passing to the
 *   moray client's .batch() method
 */
function provisionRangeUpdates(app, log, network, update, callback) {
    if (!update.hasOwnProperty('provision_start_ip') &&
        !update.hasOwnProperty('provision_end_ip')) {
        return callback();
    }

    var batch = [];
    var ipBucket = mod_ip.bucket(network.uuid);
    var toMove = [];

    if (update.hasOwnProperty('provision_start_ip') &&
        (update.provision_start_ip.toString() !==
        network.params.provision_start_ip.toString())) {
        toMove.push({
            before: util_ip.ipAddrMinus(network.params.provision_start_ip, 1),
            after: util_ip.ipAddrMinus(update.provision_start_ip, 1)
        });
    }

    if (update.hasOwnProperty('provision_end_ip') &&
        (update.provision_end_ip.toString() !==
        network.params.provision_end_ip.toString())) {
        toMove.push({
            before: util_ip.ipAddrPlus(network.params.provision_end_ip, 1),
            after: util_ip.ipAddrPlus(update.provision_end_ip, 1)
        });
    }

    function moveRecord(move, cb) {
        var oldIP = move.before;
        var newIP = move.after;
        var getOpts = {
            app: app,
            log: log,
            params: { ip: oldIP, network_uuid: network.uuid }
        };

        mod_ip.get(getOpts, function (err2, oldRec) {
            if (err2) {
                return cb(err2);
            }

            // Old IP: if it's just a placeholder record (eg: one with
            // reserved: false and nothing else set), just delete it.
            var oldRaw = oldRec.raw();


            if (!oldRaw.hasOwnProperty('belongs_to_uuid') &&
                !oldRaw.reserved) {
                // XXX LEGACY: remove this after migration is complete
                if (network.legacy) {
                    oldIP = util_ip.addressToNumber(oldIP.toString());
                }
                batch.push({
                    bucket: ipBucket.name,
                    key: oldIP.toString(),
                    operation: 'delete',
                    options: {
                        etag: oldRec.params._etag
                    }
                });
            }

            getOpts.params.ip = newIP;
            mod_ip.get(getOpts, function (err3, newRec) {
                if (err3) {
                    if (err3.statusCode === 404) {
                        // XXX LEGACY: remove this after migration is complete
                        if (network.legacy) {
                            newIP = util_ip.addressToNumber(newIP.toString());
                        }
                        batch.push({
                            bucket: ipBucket.name,
                            key: newIP.toString(),
                            operation: 'put',
                            options: {
                                etag: null
                            },
                            value: placeholderIP(newIP, network.legacy)
                        });

                        return cb();
                    }

                    // The new IP already exists, so we don't need to create
                    // it for gap detection reasons
                    return cb(err3);
                }

                return cb();
            });
        });
    }

    vasync.forEachParallel({
        func: moveRecord,
        inputs: toMove
    }, function (err) {
        return callback(err, batch);
    });
}


/**
 * Returns the serialized form of a routes object
 */
function serializeRoutes(routes) {
    var ser = {};
    for (var r in routes) {
        var val = routes[r].toString();
        ser[r] = val;
    }

    return ser;
}


/**
 * Return the subnet end IP based on the start and number of bits
 */
function subnetEnd(start, bits) {
    /*
     * Since we only use this to find the broadcast address, and broadcast
     * addresses only make sense in the land of IPv4 networks, this function
     * only works on IPv4 subnets.
     */
    if (start.kind() !== 'ipv4') {
        return null;
    }

    start = util_ip.addressToNumber(start.toString());
    var end = start + Math.pow(2, 32 - bits) - 1;
    return util_ip.toIPAddr(util_ip.numberToAddress(end));
}




/**
 * Validate gateway - allow it to be empty or a valid IP
 */
function validateGateway(name, val, cb) {
    if (val === null || val === '') {
        return cb();
    }

    return validate.IP(name, val, cb);
}


/**
 * Validate the IP with the above function, then fetch its
 * object from moray
 */
function validateAndGetIP(app, log, networkUUID, name, val, cb) {
    validate.IP(name, val, function (err, res) {
        if (err) {
            return cb(err);
        }

        var getOpts = {
            app: app,
            log: log,
            params: {
                ip: res,
                network_uuid: networkUUID
            },
            returnObject: true
        };
        mod_ip.get(getOpts, function (err2, res2) {
            if (err2) {
                return cb(err2);
            }

            var toReturn = {};
            toReturn[name] = res;
            toReturn['_' + name + 'IP'] = res2;
            return cb(null, null, toReturn);
        });
    });
}

/**
 * Validates that all provision range params are present in an update request,
 * and if so validates the provision range.
 */
function validateProvisionRangeUpdate(opts, params, parsed, cb) {
    if (!parsed.hasOwnProperty('provision_start_ip') &&
        !parsed.hasOwnProperty('provision_end_ip') &&
        !parsed.hasOwnProperty('gateway')) {
        return cb();
    }

    var toValidate = {
        subnet_bits: params.network.params.subnet_bits,
        subnet_start_ip: params.network.params.subnet_start_ip,
        provision_start_ip: parsed.provision_start_ip ||
        params.network.params.provision_start_ip,
        provision_end_ip: parsed.provision_end_ip ||
        params.network.params.provision_end_ip
    };

    if (parsed.hasOwnProperty('gateway')) {
        toValidate.gateway = parsed.gateway;
    }

    validateProvisionRange({
        app: opts.app,
        log: opts.log,
        uuid: params.network.uuid
    }, null, toValidate, cb);
}

/**
 * Validates that:
 * * the provision start and end IPs are within the subnet
 * * the gateway IP is within the subnet
 * * that end doesn't come before start.
 */
function validateProvisionRange(opts, _, parsedParams, callback) {
    if (!parsedParams.subnet_start_ip || !parsedParams.subnet_bits) {
        return callback();
    }

    var errs = [];
    var gateway = parsedParams.gateway;
    var provisionEnd = parsedParams.provision_end_ip;
    var provisionStart = parsedParams.provision_start_ip;
    var subnetBits = parsedParams.subnet_bits;
    var subnetStart = parsedParams.subnet_start_ip;
    var subnet = util.format('%s/%d', subnetStart, subnetBits);
    parsedParams.subnet = parsedParams.subnet || subnet;

    var maxIP = subnetEnd(subnetStart, subnetBits); // IPv4 only, for broadcast

    if (provisionStart && provisionEnd &&
        provisionStart.kind() !== provisionEnd.kind()) {
        errs.push(errors.invalidParam('provision_start_ip,provision_end_ip',
            constants.msg.PROV_TYPES_MISMATCH));
    }

    // check if provision range is within the subnet
    if (provisionStart && !provisionStart.match(subnetStart, subnetBits)) {
        errs.push(errors.invalidParam('provision_start_ip',
            constants.msg.PROV_START_IP_OUTSIDE));

        provisionStart = null;
        delete parsedParams.provision_start_ip;
    }
    if (provisionEnd && !provisionEnd.match(subnetStart, subnetBits)) {
        errs.push(errors.invalidParam('provision_end_ip',
            constants.msg.PROV_END_IP_OUTSIDE));

        provisionEnd = null;
        delete parsedParams.provision_end_ip;
    }

    // check if gateway is within the subnet
    if (gateway && !gateway.match(subnetStart, subnetBits)) {
        errs.push(errors.invalidParam('gateway', constants.GATEWAY_SUBNET_MSG));

        gateway = null;
        delete parsedParams.gateway;
    }

    // IPv4-only checks - broadcast address is reserved
    if (provisionStart && provisionStart.kind() === 'ipv4' &&
        provisionStart.toString() === maxIP.toString()) {

        errs.push(errors.invalidParam('provision_start_ip',
            constants.msg.PROV_START_IP_BCAST));

        provisionStart = null;
        delete parsedParams.provision_start_ip;
    }
    if (provisionEnd && provisionEnd.kind() === 'ipv4' &&
        provisionEnd.toString() === maxIP.toString()) {

        errs.push(errors.invalidParam('provision_end_ip',
            constants.msg.PROV_END_IP_BCAST));

        provisionEnd = null;
        delete parsedParams.provision_end_ip;
    }


    // check if provision start is before provision end
    if (provisionStart && provisionEnd &&
        util_ip.compareTo(provisionStart, provisionEnd) >= 0) {

        errs.push(errors.invalidParam('provision_end_ip',
                    constants.PROV_RANGE_ORDER_MSG));
        errs.push(errors.invalidParam('provision_start_ip',
                    constants.PROV_RANGE_ORDER_MSG));
    }

    if (errs.length !== 0) {
        return callback(errs);
    }

    // XXX LEGACY: remove this after migration is complete
    if (parsedParams.legacy) {
        var l_minIP = util_ip.addressToNumber(subnetStart.toString());
        var l_maxIP = util_ip.addressToNumber(maxIP.toString());
        var l_overlapFilter = util.format('(|' +
            // subnet start IP inside another network
            '(&(subnet_start_ip<=%d)(subnet_end_ip>=%d))' +
            // subnet end IP inside another network
            '(&(subnet_start_ip<=%d)(subnet_end_ip>=%d))' +
            // subnet start and end IP enclose the network
            '(&(subnet_start_ip>=%d)(subnet_end_ip<=%d))' +
            ')', l_minIP, l_minIP, l_maxIP, l_maxIP, l_minIP, l_maxIP);

        mod_moray.listObjs({
            filter: l_overlapFilter,
            log: opts.log,
            bucket: BUCKET,
            model: Network,
            moray: opts.app.moray,
            sort: {
                attribute: 'name',
                order: 'ASC'
            }
        }, function (listErr, l_overlapping) {
            if (listErr) {
                return callback(listErr);
            }

            if (opts.uuid) {
                // This is an update - filter out ourselves
                l_overlapping = l_overlapping.filter(function (n) {
                    return n.uuid !== opts.uuid;
                });
            }

            if (l_overlapping.length === 0) {
                return callback();
            }

            return callback(errors.networkOverlapParams(l_overlapping));
        });

        return;
    }

    var sql = util.format('select * from %s where ' +
        // subnet starts inside another network
        'subnet >> \'%s\' OR ' +
        // another network starts inside subnet
        'subnet_start_ip >> \'%s\'',
        BUCKET.name, subnetStart.toString(), subnet);

    opts.log.debug({
        sql: sql,
        subnet: subnet
    }, 'validateProvisionRange: finding overlapping subnets');

    var req = opts.app.moray.sql(sql);
    var overlapping = [];

    req.on('record', function (r) {

        opts.log.debug({
            rec: r
        }, 'validateProvisionRange: overlapping record found');

        if (r.uuid === opts.uuid) {
            // This is an update - filter out ourselves
            return;
        }
        overlapping.push(r);
    });

    req.once('error', function (err) {
        opts.log.error(err, 'validateProvisionRange: error');
        return callback(err);
    });

    req.once('end', function () {
        if (overlapping.length !== 0) {
            return callback(errors.networkOverlapParams(overlapping));
        }
        return callback();
    });



    // // XXX Use of the >> operator in a moray filter is blocked on MORAY-295
    // var overlapFilter = util.format('(|' +
    //     // subnet starts inside another network
    //     '(>> subnet %s)' +
    //     // another network starts inside subnet
    //     '(>> subnet_start_ip %s)' +
    //     ')', subnet, subnet, subnetStart.toString(), subnet);


    // mod_moray.listObjs({
    //     filter: overlapFilter,
    //     log: opts.log,
    //     bucket: BUCKET,
    //     model: Network,
    //     moray: opts.app.moray,
    //     sort: {
    //         attribute: 'name',
    //         order: 'ASC'
    //     }
    // }, function (listErr, overlapping) {
    //     if (listErr) {
    //         return callback(listErr);
    //     }

    //     if (opts.uuid) {
    //         // This is an update - filter out ourselves
    //         overlapping = overlapping.filter(function (n) {
    //             return n.uuid !== opts.uuid;
    //         });
    //     }

    //     if (overlapping.length === 0) {
    //         return callback();
    //     }

    //     return callback(errors.networkOverlapParams(overlapping));
    // });

}


/**
 * Validate a routes object
 */
function validateRoutes(name, val, callback) {
    if (typeof (val) !== 'object') {
        return callback(errors.invalidParam(name, 'must be an object'));
    }

    var invalid = [];
    var routes = {};

    for (var r in val) {
        var badVals = [];
        var ipAddr = util_ip.toIPAddr(r);
        var key;
        var subnet = util_subnet.toNumberArray(r);

        if (!ipAddr && !subnet) {
            badVals.push(r);
        }

        var gateway = util_ip.toIPAddr(val[r]);
        if (!gateway) {
            badVals.push(val[r]);
        }

        if (badVals.length !== 0) {
            invalid.push(badVals);
            continue;
        }

        key = ipAddr ? ipAddr.toString() :
            util.format('%s/%d', subnet[0].toString(), subnet[1]);
        routes[key] = gateway;
    }

    if (invalid.length !== 0) {
        var err = errors.invalidParam(name,
            util.format('invalid route%s', invalid.length === 1 ? '' : 's'));
        err.invalid = [];
        invalid.forEach(function (i) {
            i.forEach(function (b) {
                err.invalid.push(b);
            });
        });

        return callback(err);
    }

    var toReturn = {};
    toReturn[name] = routes;
    return callback(null, null, toReturn);
}


/**
 * Validates parameters and returns a network object if all parameters are
 * valid, or an error otherwise
 */
function createValidNetwork(app, log, params, callback) {
    validate.params({
        params: params,
        required: {
            name: validate.string,
            nic_tag: mod_nicTag.validateExists.bind(null, app, log, true),
            provision_end_ip: validate.IP,
            provision_start_ip: validate.IP,
            subnet: validate.subnet,
            vlan_id: validate.VLAN
        },
        optional: {
            description: validate.string,
            gateway: validateGateway,
            mtu: validate.networkMTU,
            owner_uuids: validate.UUIDarray,
            routes: validateRoutes,
            resolvers: validate.ipArray,
            uuid: validate.UUID,
            virtual: validate.bool,
            legacy: validate.bool
        },
        after: [
            validateProvisionRange.bind(null, { app: app, log: log }),
            validateNicTagMTU.bind(null, {app: app, log: log})
        ]
    }, function (err, validatedParams) {
        if (err) {
            return callback(err);
        }
        return callback(null, new Network(validatedParams));
    });
}

/**
 * Helper function for validateNicTagMTU that actually performs the validation.
 */
function _validateNicTagMTU(opts, nic_tag, mtu, callback) {
    return mod_nicTag.get(opts.app, opts.log, { name: nic_tag },
        function (err, nicTag) {

        if (err) {
            return callback(err);
        }

        if (nicTag.params.mtu < mtu) {
            return callback(errors.invalidParam('mtu',
                constants.MTU_NETWORK_GT_NICTAG));
        }

        return callback();
    });
}

/**
 * Validates that if an mtu value is present, that it is under the network's
 * nic_tag's mtu value.
 */
function validateNicTagMTU(opts, params, parsed, callback) {

    // an update that didn't specify mtu.
    if (!parsed.hasOwnProperty('mtu')) {
        return callback();
    }

    // an update that specified mtu, doesn't include nic_tag
    if (!parsed.hasOwnProperty('nic_tag')) {
        return getNetwork(opts.app, opts.log, { uuid: params.uuid },
            function (err, network) {
            if (err) {
                return callback(err);
            }
            return _validateNicTagMTU(opts, network.params.nic_tag, parsed.mtu,
                callback);
        });
    }

    // create will always have at least a nic_tag and default mtu.
    return _validateNicTagMTU(opts, parsed.nic_tag, parsed.mtu, callback);
}



// --- Network object



/**
 * Network model constructor
 */
function Network(params) {
    var subnet = params.subnet ? params.subnet.split('/') :
        [params.subnet_start_ip, params.subnet_bits];

    this.params = {
        name: params.name,
        nic_tag: params.nic_tag,
        provision_start_ip: util_ip.toIPAddr(params.provision_start_ip),
        provision_end_ip: util_ip.toIPAddr(params.provision_end_ip),
        subnet_start_ip: util_ip.toIPAddr(subnet[0]),
        subnet_bits: Number(subnet[1]),
        uuid: params.uuid,
        vlan_id: Number(params.vlan_id),
        virtual: params.virtual || false,
        mtu: Number(params.mtu) || constants.MTU_DEFAULT
    };
    this.params.subnet_type = this.params.subnet_start_ip.kind();

    this.etag = params.etag || null;

    if (!params.uuid) {
        this.params.uuid = UUID.v4();
    }

    if (params.gateway) {
        this.params.gateway = util_ip.toIPAddr(params.gateway);
    }

    if (params.routes) {
        this.params.routes = {};
        for (var r in params.routes) {
            this.params.routes[r] = util_ip.toIPAddr(params.routes[r]);
        }
    }

    if (params.hasOwnProperty('owner_uuids')) {
        this.params.owner_uuids = params.owner_uuids;
        mod_moray.valToArray(this.params, 'owner_uuids');
        if (this.params.owner_uuids && this.params.owner_uuids.length === 0) {
            delete this.params.owner_uuids;
        }
    }

    if (params.hasOwnProperty('description')) {
        this.params.description = params.description;
    }

    if (params.resolvers) {
        this.params.resolvers = util_common.arrayify(params.resolvers).map(
            util_ip.toIPAddr);
    }


    this.provisionMax = this.params.provision_end_ip;
    this.provisionMin = this.params.provision_start_ip;
    this.subnetBits = this.params.subnet_bits;
    this.subnetStart = this.params.subnet_start_ip;
    this.subnetType = this.params.subnet_type;

    this.__defineGetter__('uuid', function () { return this.params.uuid; });

    // XXX LEGACY: remove this after migration is complete
    this.legacy = params.legacy;
}


/**
 * Raw form suitable for adding to a moray batch
 */
Network.prototype.batch = function networkBatch() {
    return {
        bucket: BUCKET.name,
        key: this.params.uuid,
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag
        }
    };
};


/**
 * Returns the raw form suitable for storing in moray
 */
Network.prototype.raw = function networkRaw() {
    // XXX LEGACY: remove this after migration is complete
    if (this.params.legacy) {
        return this.legacyRaw();
    }

    var raw = {
        uuid: this.params.uuid,
        name: this.params.name,
        vlan_id: this.params.vlan_id,
        subnet_start_ip: this.params.subnet_start_ip.toString(),
        subnet: util.format('%s/%d',
            this.params.subnet_start_ip.toString(),
            this.params.subnet_bits),
        subnet_type: this.params.subnet_type,
        nic_tag: this.params.nic_tag,
        v: BUCKET.migrationVersion,
        mtu: this.params.mtu
    };
    var self = this;


    if (this.params.hasOwnProperty('owner_uuids')) {
        raw.owner_uuids = mod_moray.arrayToVal(this.params.owner_uuids);
    }

    if (this.params.hasOwnProperty('resolvers')) {
        raw.resolvers = this.params.resolvers.map(function (r) {
            return r.toString();
        });
    }

    if (this.params.hasOwnProperty('routes')) {
        raw.routes = serializeRoutes(this.params.routes);
    }

    ['description', 'gateway', 'provision_end_ip',
        'provision_start_ip'].forEach(function (opt) {

        if (self.params.hasOwnProperty(opt)) {
            raw[opt] = self.params[opt].toString();
        }
    });

    return raw;
};


// XXX LEGACY: remove this after migration is complete
Network.prototype.legacyRaw = function networkLegacyRaw() {
    function aton(ip) {
        return util_ip.addressToNumber(ip.toString());
    }
    var raw = {
        uuid: this.params.uuid,
        name: this.params.name,
        vlan_id: this.params.vlan_id,
        subnet_end_ip: aton(subnetEnd(this.params.subnet_start_ip,
            this.params.subnet_bits)),
        subnet_start_ip: aton(this.params.subnet_start_ip),
        subnet_bits: this.params.subnet_bits,
        provision_start_ip: aton(this.params.provision_start_ip),
        provision_end_ip: aton(this.params.provision_end_ip),
        nic_tag: this.params.nic_tag,
        v: BUCKET.migrationVersion
    };
    var self = this;

    if (this.params.hasOwnProperty('owner_uuids')) {
        raw.owner_uuids = mod_moray.arrayToVal(this.params.owner_uuids);
    }

    if (this.params.hasOwnProperty('gateway')) {
        raw.gateway = aton(this.params.gateway);
    }


    if (this.params.hasOwnProperty('routes')) {
        raw.routes = {};
        for (var k in this.params.routes) {
            raw.routes[k] = aton(this.params.routes.routes[k]);
        }
    }

    if (this.params.hasOwnProperty('resolvers')) {
        raw.resolvers = this.params.resolvers.map(aton);
    }

    ['description'].forEach(function (opt) {
        if (self.params.hasOwnProperty(opt)) {
            raw[opt] = self.params[opt];
        }
    });

    return raw;
};


/**
 * Returns the serialized form of the network
 */
Network.prototype.serialize = function networkSerialize() {
    var self = this;
    var ser = {
        uuid: this.params.uuid,
        name: this.params.name,
        vlan_id: this.params.vlan_id,
        subnet: util.format('%s/%d',
            this.params.subnet_start_ip.toString(),
            this.params.subnet_bits),
        provision_start_ip: this.params.provision_start_ip.toString(),
        provision_end_ip: this.params.provision_end_ip.toString(),
        nic_tag: this.params.nic_tag,
        mtu: this.params.mtu
    };

    if (this.params.resolvers) {
        ser.resolvers = this.params.resolvers.map(function (r) {
            return r.toString();
        });
    }

    if (this.params.gateway) {
        ser.gateway = this.params.gateway.toString();
    }

    if (this.params.routes) {
        ser.routes = serializeRoutes(this.params.routes);
    }

    ['owner_uuids', 'description'].forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            ser[param] = self.params[param];
        }
    });

    // IPv4 Only
    if (this.params.subnet_start_ip.kind() === 'ipv4') {
        ser.netmask = util_ip.bitsToNetmask(this.params.subnet_bits);
    }

    return ser;
};



/**
 * Returns whether or not a UUID is an owner of the network
 */
Network.prototype.isOwner = function networkHasOwner(owner) {
    if (!this.params.hasOwnProperty('owner_uuids') ||
        this.params.owner_uuids.length === 0) {
        return true;
    }

    return (this.params.owner_uuids.concat(
        constants.UFDS_ADMIN_UUID).indexOf(owner) !== -1);
};



// --- Exported functions



/**
 * Creates a new network
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}:
 * - `name` {String}: network name (required)
 * - `gateway` {IP}: gateway
 * - `nic_tag` {String}: nic tag name (required)
 * - `provision_start_ip` {IP}: start address for provision range (required)
 * - `provision_end_ip` {IP}: end address for provision range (required)
 * - `resolvers` {IP Array}: DNS resolvers
 * - `vlan_id` {Number}: VLAN ID (required)
 * - `mtu` {Number}: MTU value
 * @param callback {Function} `function (err, netObj)`
 */
function createNetwork(app, log, params, callback) {
    log.debug(params, 'createNetwork: entry');
    var network;

    vasync.pipeline({
        funcs: [
        function _createNetObj(_, cb) {
            createValidNetwork(app, log, params, function (err, res) {
                if (err) {
                    return cb(err);
                }

                network = res;
                return cb();
            });
        },

        function _createNet(_, cb) {
            app.moray.putObject(BUCKET.name, network.uuid, network.raw(), cb);
        },

        function _createIPbucket(_, cb) {
            mod_ip.bucketInit(app, log, network.uuid, cb);
        },

        function _createIPs(_, cb) {
            // Create reserved IP records for:
            // * gateway (if specified)
            // * resolvers (if they're in the same subnet)
            // * broadcast address

            // XXX LEGACY: remove this after migration is complete
            var legacy = network.legacy;

            var ipsToCreate = {};

            if (network.params.gateway) {
                ipsToCreate[network.params.gateway.toString()] =
                    adminReservedIP(network, network.params.gateway,
                        app.config.ufdsAdminUuid, legacy);
            }

            for (var r in network.params.resolvers) {
                var num = network.params.resolvers[r];
                if (num.match(network.subnetStart, network.subnetBits) &&
                    !ipsToCreate.hasOwnProperty(num.toString())) {

                    ipsToCreate[num.toString()] = adminReservedIP(network, num,
                        app.config.ufdsAdminUuid, legacy);
                }
            }

            // IPv4 only: Don't allow provisioning on the broadcast address.
            if (network.subnetType === 'ipv4') {
                var maxIP = subnetEnd(network.subnetStart, network.subnetBits);
                if (!ipsToCreate.hasOwnProperty(maxIP.toString())) {
                    ipsToCreate[maxIP.toString()] = adminReservedIP(network,
                        maxIP, app.config.ufdsAdminUuid, legacy);
                }
            }

            // Add the IPs just outside the provision range to moray, so that
            // finding gaps in the range works properly.  Note that
            // these records can be outside the subnet, but we will never use
            // them: they're just markers.
            // XXX: 0.0.0.0, 255.255.255.255 and analogous IPv6 addresses will
            // under/overflow
            var lowerBound = util_ip.ipAddrMinus(network.provisionMin, 1);
            var upperBound = util_ip.ipAddrPlus(network.provisionMax, 1);
            [lowerBound, upperBound].forEach(
                function (rangeNum) {
                if (!ipsToCreate.hasOwnProperty(rangeNum)) {
                    ipsToCreate[rangeNum] = placeholderIP(rangeNum, legacy);
                }
            });

            var batch = {
                batch: Object.keys(ipsToCreate).sort().map(function (i) {
                    return ipsToCreate[i];
                }),
                network_uuid: network.uuid,
                network: network
            };

            // XXX: should create the network and the IPs in the same batch
            log.info(batch, 'Reserving IPs for network "%s"', network.uuid);
            return mod_ip.batchCreate(app, log, batch, cb);
        }

        ]
    }, function (err, res) {
        if (err) {
            return callback(err);
        }

        return callback(null, network);
    });
}


/**
 * Updates a network
 *
 * @param app {App}
 * @param log {Log}
 * @param params {Object}: All parameters are optional, except for network
 * - `network` {Network}: network to update (required)
 * - `name` {String}
 * - `description` {String}
 * - `gateway` {IP}: gateway IP address
 * - `owner_uuids` {Array of UUIDs}: network owners
 * - `provision_start_ip` {IP}: start address for provision range
 * - `provision_end_ip` {IP}: end address for provision range
 * - `resolvers` {IP Array}: DNS resolvers
 * - `routes` {Object}: DNS resolvers
 * - `mtu` {Number}: MTU for the network
 * @param callback {Function} `function (err, updatedNetworkObj)`
 */
function updateNetwork(app, log, params, callback) {
    log.debug(params, 'updateNetwork: entry');

    validate.params({
        params: params,
        optional: {
            // moray-only
            name: validate.string,
            description: validate.string,
            owner_uuids: validate.UUIDarray,
            mtu: validate.networkMTU,

            // require changes to the napi_ips_<uuid> bucket as well:

            // Get the IP - we'll need its raw values for updating
            gateway: validateAndGetIP.bind(null, app, log, params.network.uuid),
            provision_end_ip: validate.IP,
            provision_start_ip: validate.IP,

            // These parameters require changes on CNs, so we need
            // to kick off a workflow
            resolvers: validate.ipArray,
            routes: validateRoutes
            // TODO: subnet, vlan_id?
        },
        after: [
            validateProvisionRangeUpdate.bind(null, { app: app, log: log }),
            validateNicTagMTU.bind(null, { app: app, log: log })
        ]

    }, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var batch = [ {
            bucket: BUCKET.name,
            key: params.uuid,
            operation: 'put',
            value: params.network.raw()
        } ];
        var ipBucket = mod_ip.bucket(params.uuid);
        var wfParams = {
            target: 'net-update-' + params.uuid,
            task: 'update',
            networks: [],
            // Pass the original network to the workflow in case we've
            // updated any parameters used to match
            original_network: params.network.serialize(),
            update_params: {}
        };

        // -- moray-only values

        ['name', 'description', 'provision_start_ip',
            'provision_end_ip', 'mtu'].forEach(function (p) {
            if (validated.hasOwnProperty(p)) {
                batch[0].value[p] = validated[p].toString();
            }
        });

        if (validated.hasOwnProperty('owner_uuids')) {
            batch[0].value.owner_uuids =
                mod_moray.arrayToVal(validated.owner_uuids);
            if (validated.owner_uuids.length === 0) {
                delete batch[0].value.owner_uuids;
            }
        }

        // -- values that require a workflow

        if (validated.hasOwnProperty('gateway')) {
            if (!validated.gateway) {
                delete batch[0].value.gateway;
            } else {
                batch[0].value.gateway = validated.gateway.toString();
            }

            var ipRaw = validated._gatewayIP.raw();
            ipRaw.reserved = true;
            batch.push({
                bucket: ipBucket.name,
                key: ipRaw.ip.toString(),
                operation: 'put',
                value: ipRaw
            });
            wfParams.update_params.gateway =
                validated._gatewayIP.address.toString();
        }

        if (validated.hasOwnProperty('resolvers')) {
            batch[0].value.resolvers = validated.resolvers;
            wfParams.update_params.resolvers =
                validated.resolvers.map(function (r) {
                    return r.toString();
                });
        }

        if (validated.hasOwnProperty('routes')) {
            batch[0].value.routes = validated.routes;
            wfParams.update_params.routes =
                serializeRoutes(validated.routes);
        }

        provisionRangeUpdates(app, log, params.network, validated,
            function (err2, updates) {
            if (err2) {
                return callback(err2);
            }

            if (updates && updates.length !== 0) {
                batch = batch.concat(updates);
            }

            app.moray.batch(batch, function (err3) {
                if (err3) {
                    return callback(err3);
                }

                var toReturn = new Network(batch[0].value);

                if (util_common.hashEmpty(wfParams.update_params)) {
                    return callback(null, toReturn);
                }

                listNetworks(app, log, {}, function (err4, nets) {
                    if (err4) {
                        return callback(err4);
                    }

                    nets.forEach(function (n) {
                        wfParams.networks.push(n.serialize());
                    });

                    app.wfapi.createJob('net-update', wfParams,
                        function (err5, job) {
                        if (err5) {
                            return callback(err5);
                        }

                        log.info({ params: wfParams, job: job },
                            'Update job "%s" queued for network "%s"',
                            job.uuid, params.uuid);
                        toReturn.job_uuid = job.uuid;

                        return callback(null, toReturn);
                    });
                });
            });
        });
    });
}


/**
 * Lists networks, filtering by parameters
 */
function listNetworks(app, log, params, callback) {
    log.debug(params, 'listNetworks: entry');

    if (params.provisionable_by) {
        // Match both networks with that owner_uuid as well as no owner_uuid
        params.owner_uuids = [ '*,' + params.provisionable_by + ',*', '!*' ];
        delete params.provisionable_by;
    }

    mod_moray.listObjs({
        defaultFilter: '(uuid=*)',
        filter: params,
        log: log,
        bucket: BUCKET,
        model: Network,
        moray: app.moray,
        sort: {
            attribute: 'name',
            order: 'ASC'
        }
    }, callback);
}


/**
 * Gets a network
 */
function getNetwork(app, log, params, callback) {
    log.debug(params, 'getNetwork: entry');

    if (params.uuid === 'admin') {
        return mod_moray.listObjs({
            filter: '(name=admin)',
            log: log,
            bucket: BUCKET,
            model: Network,
            moray: app.moray,
            sort: {
                attribute: 'name',
                order: 'ASC'
            }
        }, function (err, list) {
            if (err) {
                return callback(err);
            }

            if (list.length > 1) {
                log.warn(list.map(function (n) { return n.serialize(); }),
                    'more than 1 admin network found');
            }

            return callback(null, list[0]);
        });
    }

    validate.params({
        params: params,
        required: {
            uuid: validate.UUID
        },
        optional: {
            provisionable_by: validate.UUID
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(app.moray, BUCKET, params.uuid, function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            var network = new Network(rec.value);

            var by = params.provisionable_by;
            if (!by || network.isOwner(by)) {
                return callback(null, network);
            }

            return callback(new restify.NotAuthorizedError(
                constants.msg.NET_OWNER));
        });
    });
}


/**
 * Deletes a network
 */
function deleteNetwork(app, log, params, callback) {
    log.debug(params, 'deleteNetwork: entry');

    validate.params({
        params: params,
        required: {
            uuid: validate.UUID
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.delObj(app.moray, BUCKET, params.uuid, function (err2) {
            if (err2) {
                return callback(err2);
            }

            var ipsBucket = mod_ip.bucket(params.uuid);
            app.moray.delBucket(ipsBucket.name, function (err3) {
                // The 'does not exist' error just means there were no IPs in
                // this network yet, so we haven't created the bucket
                if (err3 && err3.message.indexOf('does not exist') === -1) {
                    return callback(err3);
                }

                return callback();
            });
        });
    });
}


/**
 * Initializes the networks bucket
 */
function initNetworksBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


/**
 * Do any migrations required
 */
function migrateNetworks(opts, callback) {
    var log = opts.log;
    var moray = opts.app.moray;

    moray.getBucket(BUCKET.name, function (getErr, bucket) {
        if (getErr) {
            return callback(getErr);
        }

        var processed = 0;
        var version = (bucket.options ? bucket.options.version : 0) || 0;

        if (version >= BUCKET.migrationVersion) {
            log.info({
                version: version,
                migrationVersion: BUCKET.migrationVersion,
                bucket: BUCKET.name
            }, 'bucket version OK: migration not required');
            return callback();
        }

        util_common.repeat(function _processBatch(next) {
            mod_moray.listObjs({
                filter: util.format('(|(!(v=*))(v<=%d))',
                    BUCKET.migrationVersion - 1),
                log: opts.log,
                bucket: BUCKET,
                model: Network,
                moray: moray
            }, function (listErr, nets) {
                if (listErr) {
                    return next(listErr, null, false);
                }

                if (nets.length === 0) {
                    // No more unmigrated networks
                    return next(null, null, false);
                }

                var batch = nets.map(function (n) {
                    return n.batch();
                });

                log.info({ processed: processed, cur: batch.length },
                    'Migrating records');
                log.debug({ batch: batch }, 'migrate: batch');

                moray.batch(batch, function (batchErr) {
                    if (batchErr) {
                        if (batchErr.name == 'EtagConflictError') {
                            // One of the networks has been updated from under
                            // us: try it again next time
                            return next(batchErr, null, true);
                        }

                        return next(batchErr, null, false);
                    }

                    processed += batch.length;
                    log.info({ processed: processed, cur: batch.length },
                        'Migrated records');

                    // Migration succeeded - keep going
                    return next(null, null, true);
                });
            });
        }, function (afterErr) {
            if (afterErr) {
                return callback(afterErr);
            }

            log.info({ oldVersion: version, version: BUCKET.migrationVersion,
                processed: processed }, 'All pending networks migrated');

            // Now bump the bucket version to indicate that we've migrated
            var schema = clone(BUCKET.schema);
            schema.options = { version: BUCKET.migrationVersion };

            moray.updateBucket(BUCKET.name, schema, function (uErr) {
                if (uErr) {
                    return callback(uErr);
                }

                log.info({ old: version, version: BUCKET.migrationVersion },
                    'network migration complete');

                return callback();
            });
        });
    });
}



module.exports = {
    create: createNetwork,
    del: deleteNetwork,
    get: getNetwork,
    init: initNetworksBucket,
    list: listNetworks,
    migrate: migrateNetworks,
    update: updateNetwork,
    Network: Network
};

/*
 * Circular dependencies 'require'd here. DON'T ASK QUESTIONS.
 */
var mod_nicTag = require('./nic-tag');
