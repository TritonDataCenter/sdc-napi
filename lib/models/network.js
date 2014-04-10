/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * network model and related functions
 */

var assert = require('assert');
var clone = require('clone');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var mod_nicTag = require('./nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var util_subnet = require('../util/subnet');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');


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
            uuid: { type: 'string', unique: true },
            vlan_id: { type: 'number' }
        }
    }
};



// --- Internal helpers



/**
 * Returns parameters for creating an IP: reserved, belongs to admin,
 * type 'other'
 */
function adminReservedIP(network, ipNum, ufdsAdminUuid) {
    return {
        belongs_to_type: 'other',
        belongs_to_uuid: ufdsAdminUuid,
        ip: ipNum,
        network_uuid: network.params.uuid,
        owner_uuid: ufdsAdminUuid,
        reserved: true
    };
}


/**
 * Returns a placeholder IP record - one that's not reserved or taken by
 * anything, but still exists in moray for gap detection purposes
 */
function placeholderIP(num) {
    return { ip : num, reserved: false };
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
        (update.provision_start_ip !== network.params.provision_start_ip)) {
        toMove.push({
            before: network.params.provision_start_ip - 1,
            after: update.provision_start_ip - 1
        });
    }

    if (update.hasOwnProperty('provision_end_ip') &&
        (update.provision_end_ip !== network.params.provision_end_ip)) {
        toMove.push({
            before: network.params.provision_end_ip + 1,
            after: update.provision_end_ip + 1
        });
    }

    function moveRecord(move, cb) {
        var oldIP = move.before;
        var newIP = move.after;
        mod_ip.get(app, log, { ip: oldIP, network_uuid: network.uuid },
            function (err2, oldRec) {
            if (err2) {
                return cb(err2);
            }

            // Old IP: if it's just a placeholder record (eg: one with
            // reserved: false and nothing else set), just delete it.
            var oldRaw = oldRec.raw();

            if (!oldRaw.hasOwnProperty('belongs_to_uuid') &&
                !oldRaw.reserved) {
                batch.push({
                    bucket: ipBucket.name,
                    key: oldIP.toString(),
                    operation: 'delete',
                    options: {
                        etag: oldRec.params._etag
                    }
                });
            }

            mod_ip.get(app, log, { ip: newIP, network_uuid: network.uuid },
                function (err3, newRec) {
                if (err3) {
                    if (err3.statusCode === 404) {
                        batch.push({
                            bucket: ipBucket.name,
                            key: newIP.toString(),
                            operation: 'put',
                            options: {
                                etag: null
                            },
                            value: placeholderIP(newIP)
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
        var key = r.indexOf('/') !== -1 ?  util_subnet.fromNumberArray(r)
            : util_ip.ntoa(r);
        var val = util_ip.numberToAddress(routes[r]);
        ser[key] = val;
    }

    return ser;
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

        var params = {
            ip: res,
            network_uuid: networkUUID,
            returnObject: true
        };
        mod_ip.get(app, log, params, function (err2, res2) {
            if (err2) {
                return cb(err2);
            }

            var toReturn = {};
            toReturn[name] = res;
            toReturn['_' + name + 'IP'] = res2;
            return cb(null, toReturn);
        });
    });
}


/**
 * Validates that:
 * * the provision start and end IPs are within the subnet
 * * the gateway IP is within the subnet
 * * that end doesn't come before start.
 */
function validateProvisionRange(_, parsedParams, callback) {
    if (!parsedParams.subnet_start_ip || !parsedParams.subnet_bits) {
        return callback();
    }

    var errs = [];
    var minIP = parsedParams.subnet_start_ip;
    var maxIP = minIP + Math.pow(2, 32 - parsedParams.subnet_bits) - 1;

    if (parsedParams.provision_start_ip) {
        if ((parsedParams.provision_start_ip < minIP) ||
            (parsedParams.provision_start_ip > maxIP)) {
            errs.push(errors.invalidParam('provision_start_ip',
             'provision_start_ip cannot be outside subnet'));
            delete parsedParams.provision_start_ip;
        }

        if (parsedParams.provision_start_ip == maxIP) {
            errs.push(errors.invalidParam('provision_start_ip',
             'provision_start_ip cannot be the broadcast address'));
            delete parsedParams.provision_start_ip;
        }
    }

    if (parsedParams.provision_end_ip) {
        if ((parsedParams.provision_end_ip < minIP) ||
        (parsedParams.provision_end_ip > maxIP)) {
         errs.push(errors.invalidParam('provision_end_ip',
            'provision_end_ip cannot be outside subnet'));
            delete parsedParams.provision_end_ip;
        }

        if (parsedParams.provision_end_ip == maxIP) {
            errs.push(errors.invalidParam('provision_end_ip',
             'provision_end_ip cannot be the broadcast address'));
            delete parsedParams.provision_end_ip;
        }
    }

    if (parsedParams.provision_end_ip && parsedParams.provision_start_ip &&
        (parsedParams.provision_end_ip <= parsedParams.provision_start_ip)) {
        errs.push(errors.invalidParam('provision_end_ip',
                    constants.PROV_RANGE_ORDER_MSG));
        errs.push(errors.invalidParam('provision_start_ip',
                    constants.PROV_RANGE_ORDER_MSG));
    }

    if (parsedParams.gateway && (parsedParams.gateway < minIP) ||
        (parsedParams.gateway > maxIP)) {
        errs.push(errors.invalidParam('gateway',
            constants.GATEWAY_SUBNET_MSG));
        delete parsedParams.gateway;
    }

    if (errs.length !== 0) {
        return callback(errs);
    }

    return callback();
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
        var ipNum = util_ip.addressToNumber(r);
        var key;
        var subnetNum = util_subnet.toNumberArray(r);

        if (!ipNum && !subnetNum) {
            badVals.push(r);
        }

        var gateway = util_ip.addressToNumber(val[r]);
        if (!gateway) {
            badVals.push(val[r]);
        }

        if (badVals.length !== 0) {
            invalid.push(badVals);
            continue;
        }

        key = ipNum ? ipNum : subnetNum.join('/');
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
    return callback(null, toReturn);
}


/**
 * Validates parameters and returns a network object if all parameters are
 * valid, or an error otherwise
 */
function createValidNetwork(app, log, params, callback) {
    // XXX: validate non-duplicate name
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
            owner_uuids: validate.UUIDarray,
            routes: validateRoutes,
            resolvers: validate.ipArray,
            uuid: validate.UUID
        },
        after: validateProvisionRange
    }, function (err, validatedParams) {
        if (err) {
            return callback(err);
        }

        return callback(null, new Network(validatedParams));
    });
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
        provision_end_ip: Number(params.provision_end_ip) ||
            util_ip.addressToNumber(params.provision_end_ip),
        provision_start_ip: Number(params.provision_start_ip) ||
            util_ip.addressToNumber(params.provision_start_ip),
        subnet_bits: Number(subnet[1]),
        subnet_start_ip: Number(subnet[0]) ||
            util_ip.addressToNumber(subnet[0]),
        uuid: params.uuid,
        vlan_id: Number(params.vlan_id)
    };

    if (!params.uuid) {
        this.params.uuid = UUID.v4();
    }

    if (params.gateway) {
        this.params.gateway = Number(params.gateway) ||
            util_ip.addressToNumber(params.gateway);
    }

    if (params.routes) {
        this.params.routes = params.routes;
    }

    mod_moray.valToArray(params, 'owner_uuids');
    if (params.owner_uuids) {
        this.params.owner_uuids = params.owner_uuids;
    }

    if (params.hasOwnProperty('description')) {
        this.params.description = params.description;
    }

    if (params.resolvers) {
        this.params.resolvers = util_common.arrayify(params.resolvers)
            .map(function (r) {
                return Number(r) || util_ip.addressToNumber(r);
        });
    }

    this.minIP = this.params.subnet_start_ip;
    this.maxIP = this.minIP + Math.pow(2, 32 - this.params.subnet_bits) - 1;

    this.provisionMin = this.params.provision_start_ip;
    this.provisionMax = this.params.provision_end_ip;

    this.__defineGetter__('uuid', function () { return this.params.uuid; });
}


/**
 * Returns the raw form suitable for storing in moray
 */
Network.prototype.raw = function networkRaw() {
    var raw = {
        uuid: this.params.uuid,
        name: this.params.name,
        vlan_id: this.params.vlan_id,
        subnet_start_ip: this.params.subnet_start_ip,
        subnet_bits: this.params.subnet_bits,
        provision_start_ip: this.params.provision_start_ip,
        provision_end_ip: this.params.provision_end_ip,
        nic_tag: this.params.nic_tag
    };
    var self = this;

    if (this.params.owner_uuids) {
        raw.owner_uuids = mod_moray.arrayToVal(this.params.owner_uuids);
    }

    ['description', 'gateway', 'resolvers', 'routes'].forEach(function (opt) {
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
            util_ip.numberToAddress(this.params.subnet_start_ip),
            this.params.subnet_bits),
        netmask: util_ip.bitsToNetmask(this.params.subnet_bits),
        provision_start_ip:
            util_ip.numberToAddress(this.params.provision_start_ip),
        provision_end_ip: util_ip.numberToAddress(this.params.provision_end_ip),
        nic_tag: this.params.nic_tag
    };

    var r;
    var resolvers = [];
    for (r in this.params.resolvers) {
        resolvers.push(util_ip.numberToAddress(this.params.resolvers[r]));
    }
    ser.resolvers = resolvers;

    if (this.params.gateway) {
        ser.gateway = util_ip.numberToAddress(this.params.gateway);
    }

    if (this.params.routes) {
        ser.routes = serializeRoutes(this.params.routes);
    }

    ['owner_uuids', 'description'].forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            ser[param] = self.params[param];
        }
    });

    return ser;
};


/**
 * Returns a random IP in the network's provisionable range
 */
Network.prototype.randomIPnum = function networkRandomIPnum() {
    return Math.floor(Math.random() *
        Number(this.params.provision_end_ip - this.params.provision_start_ip))
        + Number(this.params.provision_start_ip);
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
            mod_ip.bucketInit(app, network.uuid, cb);
        },

        function _createIPs(_, cb) {
            // Create reserved IP records for:
            // * gateway (if specified)
            // * resolvers (if they're in the same subnet)
            // * broadcast address

            var ipsToCreate = {};

            if (network.params.gateway) {
                ipsToCreate[network.params.gateway] =
                    adminReservedIP(network, network.params.gateway,
                        app.config.ufdsAdminUuid);
            }

            for (var r in network.params.resolvers) {
                var num = network.params.resolvers[r];
                if ((network.minIP <= num) && (num <= network.maxIP) &&
                    !ipsToCreate.hasOwnProperty(num)) {
                    ipsToCreate[num] = adminReservedIP(network, num,
                        app.config.ufdsAdminUuid);
                }
            }

            // Don't allow provisioning on the broadcast address
            if (!ipsToCreate.hasOwnProperty(network.maxIP)) {
                ipsToCreate[network.maxIP] = adminReservedIP(network,
                    network.maxIP, app.config.ufdsAdminUuid);
            }

            // Add the IPs just outside the provision range to moray, so that
            // finding gaps in the range works properly.  Note that
            // these records can be outside the subnet, but we will never use
            // them: they're just markers.
            [network.provisionMin - 1, network.provisionMax + 1].forEach(
                function (rangeNum) {
                if (!ipsToCreate.hasOwnProperty(rangeNum)) {
                    ipsToCreate[rangeNum] = placeholderIP(rangeNum);
                }
            });

            var batch = {
                batch: Object.keys(ipsToCreate).sort().map(function (i) {
                    return ipsToCreate[i];
                }),
                network_uuid: network.uuid
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
        after: function (_, parsed, cb) {
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

            validateProvisionRange(null, toValidate, cb);
        }

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
            'provision_end_ip'].forEach(function (p) {
            if (validated.hasOwnProperty(p)) {
                batch[0].value[p] = validated[p];
            }
        });

        if (validated.hasOwnProperty('owner_uuids')) {
            batch[0].value.owner_uuids =
                mod_moray.arrayToVal(validated.owner_uuids);
        }

        // -- values that require a workflow

        if (validated.hasOwnProperty('gateway')) {
            if (!validated.gateway) {
                delete batch[0].value.gateway;
            } else {
                batch[0].value.gateway = validated.gateway;
            }

            var ipRaw = validated._gatewayIP.raw();
            ipRaw.reserved = true;
            batch.push({
                bucket: ipBucket.name,
                key: ipRaw.ip.toString(),
                operation: 'put',
                value: ipRaw
            });
            wfParams.update_params.gateway = validated._gatewayIP.address;
        }

        if (validated.hasOwnProperty('resolvers')) {
            batch[0].value.resolvers = validated.resolvers;
            wfParams.update_params.resolvers =
                validated.resolvers.map(function (r) {
                    return util_ip.ntoa(r);
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

            return callback(new Error('Owner cannot provision on network'));
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



module.exports = {
    create: createNetwork,
    del: deleteNetwork,
    get: getNetwork,
    init: initNetworksBucket,
    list: listNetworks,
    update: updateNetwork,
    Network: Network
};
