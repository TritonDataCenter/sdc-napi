/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * network model and related functions
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('../util/errors');
var fmt = require('util').format;
var ipaddr = require('ip6addr');
var jsprim = require('jsprim');
var lomstream = require('lomstream');
var mod_ip = require('./ip');
var mod_moray = require('../apis/moray');
var mod_portolan_moray = require('portolan-moray');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var util_ip = require('../util/ip');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');
var VError = require('verror');
var autoalloc = require('../util/autoalloc');
var mod_subnet_streams = require('../util/subnet-streams');

/*
 * Circular dependencies required at end of file.
 */
var mod_nicTag; // = require('./nic-tag');
var mod_nic_list; // = require('./nic/list').list;


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
            fabric: { type: 'boolean' },
            gateway_addr: { type: 'ip' },
            mtu: { type: 'number' },
            name_str: { type: 'string', unique: true },
            nic_tag: { type: 'string' },
            owner_uuids_arr: { type: '[string]' },
            provision_end_ip_addr: { type: 'ip' },
            provision_start_ip_addr: { type: 'ip' },
            resolver_addrs: { type: '[ip]' },
            subnet: { type: 'subnet' },
            subnet_bits: { type: 'number' },
            subnet_start: { type: 'ip' },
            subnet_type: { type: 'string' },
            uuid: { type: 'string', unique: true },
            v: { type: 'number' },
            vlan_id: { type: 'number' },
            vnet_id: { type: 'number' },

            // Deprecated indexes, left here in case we need to rollback:
            name: { type: 'string', unique: true },
            owner_uuids: { type: 'string' },
            subnet_end_ip: { type: 'number' },
            subnet_start_ip: { type: 'number' }
        }
    },
    morayVersion: 2,        // moray version must be > than this
    version: 4
};

// Names that are allowed to be used in the "fields" filter
var VALID_FIELDS = [
    'description',
    'fabric',
    'internet_nat',
    'gateway',
    'mtu',
    'name',
    'nic_tag',
    'owner_uuid',
    'owner_uuids',
    'provision_end_ip',
    'provision_start_ip',
    'resolvers',
    'routes',
    'subnet',
    'uuid',
    'vlan_id'
];

/*
 * These are fields that can never be changed. (Note that "subnet"
 * is one of them, but we handle that separately, since it needs
 * to be compared differently.)
 */
var IMMUTABLE_NET_FIELDS = [
    'fabric',
    'family',
    'gateway_provisioned',
    'internet_nat',
    'nic_tag',
    'vlan_id',
    'vnet_id'
];

/*
 * These are fields that can be changed on normal networks, but not
 * on fabrics:
 */
var IMMUTABLE_FABRIC_FIELDS = [
    'gateway',
    'owner_uuids'
];

var CONTAINING_NET_SQL = 'SELECT uuid FROM %s' +
    ' WHERE subnet >> $1 AND vlan_id = $2 AND nic_tag = $3';

var OVERLAP_SQL_PREFIX =
    'SELECT _id, uuid FROM %s WHERE (subnet >> $1 OR subnet_start << $2)';

var OVERLAP_NORMAL_NET_SQL = OVERLAP_SQL_PREFIX +
    ' AND fabric != true;';

var OVERLAP_FABRIC_NET_SQL = OVERLAP_SQL_PREFIX +
    ' AND fabric = true AND vnet_id = $3;';


// --- Schema validation objects


var CREATE_SCHEMA = {
    required: {
        name: validate.string,
        nic_tag: function _nicTagExists(opts, name, tags, callback) {
            mod_nicTag.validateExists(true, opts, name, tags, callback);
        },
        vlan_id: validate.VLAN
    },
    optional: {
        description: validate.string,
        // XXX: allow this?
        fabric: validate.bool,
        subnet_alloc: validate.bool,
        family: validate.enum(['ipv4']),
        subnet_prefix: validate.subnetPrefix,
        subnet: validate.subnet,
        provision_end_ip: validate.IP,
        provision_start_ip: validate.IP,
        fields: validate.fieldsArray(VALID_FIELDS),
        gateway: validateGateway,
        internet_nat: validate.bool,
        mtu: validate.networkMTU,
        owner_uuids: validate.UUIDarray,
        routes: validateRoutes,
        resolvers: validate.ipArray,
        uuid: validate.UUID,
        vnet_id: validate.VxLAN
    },
    after: [
        validateFabricOwner,
        validateAddressFamily,
        validateSubnetAlloc,
        validateProvisionRange,
        validateNicTagMTU
    ]
};

var UPDATE_SCHEMA = {
    optional: {
        // moray-only
        name: validate.string,
        description: validate.string,
        owner_uuids: validate.UUIDarray,
        mtu: validate.networkMTU,

        // require changes to the napi_ips_<uuid> bucket as well:

        // Get the IP - we'll need its raw values for updating
        gateway: validateAndGetIP,
        provision_end_ip: validate.IP,
        provision_start_ip: validate.IP,

        // These parameters require changes on CNs, so we need
        // to kick off a workflow
        resolvers: validate.ipArray,
        routes: validateRoutes,
        attached_networks: validate.UUIDarray,

        // Immutable network properties
        fabric: validate.bool,
        family: validate.enum([ 'ipv4', 'ipv6' ]),
        nic_tag: validate.string,
        subnet: validate.subnet,
        vlan_id: validate.VLAN,
        vnet_id: validate.VxLAN,

        // Immutable fabrics properties
        gateway_provisioned: validate.bool,
        internet_nat: validate.bool
    },
    after: [
        validateImmutableFields,
        validateAddressFamily,
        validateProvisionRangeUpdate,
        validateNicTagMTU
    ]
};

var LIST_SCHEMA = {
    strict: true,
    optional: {
        uuid: validate.uuidPrefix,
        fabric: validate.bool,
        family: validate.enum([ 'ipv4', 'ipv6' ]),
        limit: validate.limit,
        name: validate.stringOrArray,
        nic_tag: validate.stringOrArray,
        offset: validate.offset,
        owner_uuid: validate.UUID,
        provisionable_by: validate.UUID,
        vlan_id: validate.VLAN
    }
};

var GET_SCHEMA = {
    required: {
        uuid: validateGetUUID
    },
    optional: {
        fields: validate.fieldsArray(VALID_FIELDS),
        owner_uuid: validate.UUID,
        provisionable_by: validate.UUID
    }
};


// --- Internal

function getMarkerSubnet(net_obj) {
    return (net_obj.subnet);
}

function getKind(a) {
    if (typeof (a.kind) === 'function') {
        return a.kind();
    }

    return a.address().kind();
}



/**
 * Given a NIC, return a UsedBy error description for a 'nic',
 * suitable for an InUseError.
 */
function nicUsedByError(nic) {
    return errors.usedBy('nic', nic.mac.toString());
}


/**
 * Returns parameters for creating an IP: reserved, belongs to admin,
 * type 'other'
 */
function adminReservedIP(network, ipNum, ufdsAdminUuid) {
    var params = {
        belongs_to_type: 'other',
        belongs_to_uuid: ufdsAdminUuid,
        network: network,
        network_uuid: network.params.uuid,
        owner_uuid: ufdsAdminUuid,
        reserved: true
    };

    if (network.ip_use_strings) {
        params.ipaddr = ipNum.toString();
    } else {
        params.ip = ipNum.toLong();
    }
    return params;
}


/**
 * Returns parameters for creating an IP: reserved, belongs to user,
 * type 'other'
 */
function userReservedIP(network, ipNum, userUuid) {
    var params = {
        belongs_to_type: 'other',
        belongs_to_uuid: '00000000-0000-0000-0000-000000000000',
        network: network,
        network_uuid: network.params.uuid,
        owner_uuid: userUuid,
        reserved: true
    };

    if (network.ip_use_strings) {
        params.ipaddr = ipNum.toString();
    } else {
        params.ip = ipNum.toLong();
    }
    return params;
}


/**
 * If `provisionable_by` or `owner_uuid` are specified in params, only return
 * the network if its owner matches.
 */
function returnNetworkIfOwner(params, network, callback) {
    if (params.owner_uuid &&
            !network.isOwner(params.owner_uuid)) {
        // If this is a fabric (where owner_uuid is part of the
        // restify path), don't return the network if the user doesn't
        // own it:
        return callback(new restify.ResourceNotFoundError(
            'network not found'));
    }

    var by = params.provisionable_by;
    if (!by || network.isOwner(by)) {
        return callback(null, network);
    }

    return callback(new restify.NotAuthorizedError(
        constants.msg.NET_OWNER));
}


/**
 * Return a name string for storing in moray.  The "name_str" column is unique,
 * but for fabrics, we want that name to be unique per-user.  We therefore
 * prefix the name with the owner UUID for fabrics, and "global" otherwise.
 * This ensures that "real" networks have a unique namespace, and each fabric
 * user has their own unique namespace.
 */
function nameStr(params) {
    var pfx = 'global';

    if (params.fabric && params.owner_uuids) {
        pfx = params.owner_uuids[0];
    }

    return pfx + ':' + params.name;
}


/**
 * Returns a placeholder IP record - one that's not reserved or taken by
 * anything, but still exists in moray for gap detection purposes
 */
function placeholderIP(network, num) {
    var params = {
        network: network,
        network_uuid: network.uuid,
        reserved: false
    };

    if (network.ip_use_strings) {
        params.ipaddr = num.toString();
    } else {
        params.ip = num.toLong();
    }

    return params;
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
        update.provision_start_ip.compare(network.params.provision_start_ip) !==
        0) {
        toMove.push({
            before: util_ip.ipAddrMinus(network.params.provision_start_ip, 1),
            after: util_ip.ipAddrMinus(update.provision_start_ip, 1)
        });
    }

    if (update.hasOwnProperty('provision_end_ip') &&
        update.provision_end_ip.compare(network.params.provision_end_ip) !==
        0) {
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
            params: { ip: oldIP, network: network, network_uuid: network.uuid }
        };

        mod_ip.get(getOpts, function (err2, oldRec) {
            var oldIPKey = mod_ip.key(network.ip_use_strings, oldIP);
            var newIPKey = mod_ip.key(network.ip_use_strings, newIP);

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
                    key: oldIPKey,
                    operation: 'delete',
                    options: {
                        etag: oldRec.params._etag
                    }
                });
            }

            getOpts.params.ip = newIP;
            mod_ip.get(getOpts, function (err3, _) {
                if (err3) {
                    if (err3.statusCode === 404) {
                        batch.push({
                            bucket: ipBucket.name,
                            key: newIPKey,
                            operation: 'put',
                            options: {
                                etag: null
                            },
                            value: new mod_ip.IP(placeholderIP(network,
                                newIP)).raw()
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
 * Attempt to gather multiple networks for a particular owner
 *
 * @param app {App}
 * @param log {Bunyan Logger}
 * @param params {Object}:
 * - `owner` {UUID}: resolved network should be owned by this user
 * - `fabric` {Boolean}: resolved network should be a fabric
 * - `networks` {Array of UUIDs}: array of networks to lookup
 * @param callback {Function} `function (err, networks)`
 * - Where networks is an array of the resolved raw network objects
 */
function gatherNetworks(app, log, params, callback) {
    assert.object(app, 'app');
    assert.object(log, 'log');
    assert.object(params, 'params');
    assert.uuid(params.owner, 'params.owner');
    assert.bool(params.fabric, 'params.fabric');
    assert.arrayOfUuid(params.networks, 'params.networks');

    var rawNetworks = [];

    vasync.forEachParallel({
        'func': function lookupNetwork(net, cb) {
            var opts = {
                app: app,
                log: log,
                params: { uuid: net }
            };
            getNetwork(opts, function onGetNetwork(getErr, res) {
                if (getErr) {
                    cb(getErr);
                    return;
                }
                if (params.fabric) {
                    if (res.params.fabric !== true) {
                        cb(new restify.UnprocessableEntityError('network is' +
                            ' not a fabric'));
                        return;
                    }
                }
                if (res.params.owner_uuids.length !== 1) {
                    cb(new restify.UnprocessableEntityError('network has more' +
                        ' than one owner'));
                    return;
                }
                if (res.params.owner_uuids[0] !== params.owner) {
                    cb(new restify.NotAuthorizedError(
                        constants.msg.NET_OWNER));
                    return;
                }

                log.debug({uuid: net, raw: res}, 'found network');
                rawNetworks.push(res);
                cb(null, res);
            });
        },
        'inputs': params.networks
    }, function (err, results) {
        if (err) {
            callback(err);
            return;
        }
        callback(null, rawNetworks);
    });
}

/**
 * Ensure each network passed in has a router NIC assocaited with it.
 *
 * Steps:
 * - List networks NICs filtering by 'belongs_to_type: router'
 * - If the NIC is not found provision one
 *
 * @param app {App}
 * @param log {Bunyan Logger}
 * @param networks {Array of UUID}: Networks to check/create a router NIC on
 * @param callback {Function} `function (err, nics)`
 * - Where networks is an array of the updated raw network objects
 */
function provisionNetworkRouterNic(app, log, network, attNetworks, callback) {
    assert.object(app, 'app');
    assert.object(log, 'log');
    assert.uuid(network, 'network');
    assert.arrayOfUuid(attNetworks, 'attNetworks');
    assert.func(callback, 'callback');

    // Get a new array with all networks in it
    var networks = attNetworks.concat(network);
    var toReturn = {};

    function provisionRouterNic(net, cb) {
        var createOpts = {
            app: app,
            log: log,
            params: {
                owner_uuid: app.config.ufdsAdminUuid,
                belongs_to_type: 'router',
                belongs_to_uuid: net,
                network_uuid: net,
                state: 'running'
            }
        };

        app.models.nic.create(createOpts, cb);
    }

    function getRouterNic(net, cb) {
        var listOpts = {
            app: app,
            log: log,
            params: {
                network_uuid: net,
                belongs_to_type: 'router'
            }
        };

        mod_nic_list(listOpts, function onNicList(err, nics) {
            if (err) {
                cb(err);
                return;
            }

            if (nics.length > 1) {
                log.error({router_nics: nics}, 'found too many router nics');
                // Make a helper in utils/errors ?
                cb(new VError('network should only have one router nic'));
                return;
            }
            if (nics.length === 1) {
                toReturn[net] = nics[0];
                cb();
                return;
            }

            provisionRouterNic(network, function onCreateNic(pErr, nic) {
                if (pErr) {
                    cb(pErr);
                    return;
                }

                toReturn[network] = nic;
                cb();
            });
        });
    }

    vasync.forEachParallel({
        'func': getRouterNic,
        'inputs': networks
    }, function (err, results) {
        if (err) {
            // XXX Fix calling InternalError
            callback(err);
            // callback(errors.InternalError(err, 'failed to provision one or' +
            //    ' more router nics'));
            return;
        }
        callback(null, toReturn);
    });
}

/**
 * Generate vnet_route mappings for networks being attached
 *
 * @param network { Network }
 * @param attNetworks {Array of Networks}: Networks being attached
 * @param callback {Function} `function (batch)`
 * - Where batch is an array of moray batch objects for vnet_routes
 */
function vnetRouteAddBatch(network, attNetworks, routers, callback) {
    assert.object(network, 'network');
    assert.arrayOfObject(attNetworks, 'attNetworks');
    assert.object(routers, 'routers');
    assert.func(callback, 'callback');

    var batch = [];

    attNetworks.forEach(function addForwardRoute(net) {
        var remote = net.serialize();

        // Add Forward lookup
        var fwd = {
            net_uuid: network.uuid,
            vnet_id: network.vnet_id,
            vlan_id: network.vlan_id,
            subnet: network.subnet,
            r_dc_id: 0, // hardcoded for now
            r_net_uuid: remote.uuid,
            r_vnet_id: remote.vnet_id,
            r_vlan_id: remote.vlan_id,
            r_subnet: remote.subnet,
            r_send_mac: routers[network.uuid].params.mac
        };

        // Add reverse lookup
        var rev = {
            net_uuid: remote.uuid,
            vnet_id: remote.vnet_id,
            vlan_id: remote.vlan_id,
            subnet: remote.subnet,
            r_dc_id: 0, // hardcoded for now
            r_net_uuid: network.uuid,
            r_vnet_id: network.vnet_id,
            r_vlan_id: network.vlan_id,
            r_subnet: network.subnet,
            r_send_mac: routers[remote.uuid].params.mac
        };

        batch.push(mod_portolan_moray.vnetRouteMappingBatch(fwd));
        batch.push(mod_portolan_moray.vnetRouteMappingBatch(rev));
    });

    callback(batch);
}

/**
 * XXX MIKE update me
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
function provisionAttachedNetworkUpdates(app, log, network, attNetworks,
    callback) {
    assert.object(app, 'app');
    assert.object(log, 'log');
    assert.object(network, 'network');
    assert.array(attNetworks, 'attNetworks');
    assert.func(callback, 'callback');

    var rawRouterNics; // populated in step 3
    var rawNetworks = {}; // populated in step 1
    var currentNetworks = network.attached_networks.map(function (net) {
        return net.r_net_uuid;
    });

    var attachingNetworks = [];
    var removingNetworks = [];

    // The batched vnet_routes
    // - batch
    // - routes
    var toReturn = {};

    vasync.pipeline({ arg: toReturn, funcs: [

        // 1. Lookup each of the networks passed in

        function _gatherNetworks(_, cb) {
            var params = {
                owner: network.owner_uuids_arr[0], // make sure of this
                fabric: true,
                networks: attNetworks
            };
            gatherNetworks(app, log, params, function onNetworks(gErr, nets) {
                if (gErr) {
                    // what should we do with the multi error?
                    cb(gErr);
                    return;
                }

                nets.forEach(function mapNetToUuid(_net) {
                    rawNetworks[_net.uuid] = _net;
                });

                cb();
            });
        },

        // 2. Determine what networks are being added and which removed

        function diffNetworks(_, cb) {
            // Networks being attached
            attNetworks.forEach(function (net) {
                if (currentNetworks.indexOf(net) === -1) {
                    attachingNetworks.push(net);
                }
            });

            // Networks being removed
            currentNetworks.forEach(function (net) {
                if (attNetworks.indexOf(net) === -1) {
                    removingNetworks.push(net);
                }
            });
            cb();
        },

        // 3. Ensure each network being added has a routing ip/mac

        function _provisionNetworkRouterNic(_, cb) {
            provisionNetworkRouterNic(app, log, network.uuid, attachingNetworks,
                function onRouterNics(err, routerNics) {
                if (err) {
                    cb(err);
                    return;
                }

                rawRouterNics = routerNics;
                cb();
            });
        },

        // 4. Add/Remove route in moray vnet_routes bucket

        function provisionVnetRoutes(_, cb) {
            // XXX Handle removing
            var attaching = attachingNetworks.map(function (net) {
                return rawNetworks[net];
            });

            vnetRouteAddBatch(network, attaching, rawRouterNics,
                function addBatch(batch) {
                toReturn.batch = batch;
                cb();
            });
        },

        // 5. Update the each networks routes object

        function updateRoutes(_, cb) {
            // Need to figure out if its linklocal or needs a router
            console.log(rawRouterNics);
            console.log(network.routes);
            cb();
        }
    ]}, function (err, results) {
        if (err) {
            callback(err);
            return;
        }
        callback(null, toReturn);
    });

}

/**
 * Returns the serialized form of a attached_networks array
 */
function serializeAttachedNetworks(networks) {
    var ser = [];
    networks.forEach(function (n) {
        var subnet;
        // XXX this can go away when we fix portolan-moray to insert the data
        // properly
        try {
            subnet = ipaddr.createCIDR(n.r_subnet).toString({format: 'v4'});
        } catch (_) {
            subnet = ipaddr.createCIDR(n.r_subnet).toString({format: 'v6'});
        }
        var attached = {
            network_uuid: n.r_net_uuid,
            subnet: subnet
        };
        ser.push(attached);
    });

    return ser;
}

/**
 * Returns the serialized form of a routes object, using strings
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
 * Returns the serialized form of a routes object, using numbers
 */
function routeNumbers(routes) {
    var ser = {};
    for (var r in routes) {
        var key;
        if (r.indexOf('/') >= 0) {
            var parts = r.split('/');
            key = fmt('%s/%s', util_ip.aton(parts[0]), parts[1]);
        } else {
            key = util_ip.aton(r);
        }
        var val = util_ip.aton(routes[r].toString());
        ser[key] = val;
    }

    return ser;
}


/**
 * Validate gateway - allow it to be empty or a valid IP
 */
function validateGateway(_, name, val, cb) {
    if (val === null || val === '') {
        return cb();
    }

    return validate.IP(null, name, val, cb);
}


/**
 * Validate the UUID for 'get': it's allowed to be a UUID or the string "admin"
 */
function validateGetUUID(_, name, val, cb) {
    if (typeof (val) !== 'string') {
        cb(errors.invalidParam(name, constants.msg.INVALID_UUID));
        return;
    }

    if (val === 'admin') {
        cb(null, val);
        return;
    }

    validate.UUID(null, name, val, cb);
}


/**
 * Validate the IP with the above function, then fetch its
 * object from moray
 */
function validateAndGetIP(opts, name, val, cb) {
    validate.IP(null, name, val, function (err, res) {
        if (err) {
            return cb(err);
        }

        var getOpts = {
            app: opts.app,
            log: opts.log,
            params: {
                ip: res,
                network: opts.network,
                network_uuid: opts.network.uuid
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
 * Fabric networks are only allowed to have a single owner. During network
 * creation, we check that only one owner is specified. Updates to the list
 * are prevented by validateImmutableFields().
 */
function validateFabricOwner(_opts, _original, parsedParams, cb) {
    if (!parsedParams.fabric) {
        cb();
        return;
    }

    if (!jsprim.hasKey(parsedParams, 'owner_uuids')) {
        cb(errors.missingParam('owner_uuids'));
        return;
    }

    if (parsedParams.owner_uuids.length !== 1) {
        cb(errors.invalidParam('owner_uuids',
            constants.msg.FABRIC_SINGLE_OWNER));
        return;
    }

    cb();
}


/**
 * Fabric networks have a handful of properties that shouldn't be updated.
 * We check them here to make sure they don't get changed.
 */
function validateImmutableFields(opts, _original, parsed, cb) {
    var network = opts.network;
    var errs = [];

    function done() {
        if (errs.length === 0) {
            cb();
        } else {
            cb(errs);
        }
    }

    IMMUTABLE_NET_FIELDS.forEach(function (field) {
        if (!parsed.hasOwnProperty(field)) {
            return;
        }

        if (network[field] !== parsed[field]) {
            errs.push(errors.invalidParam(field,
                constants.msg.NET_PROP_IMMUTABLE));
        }
    });

    if (parsed.hasOwnProperty('subnet') &&
        network.subnet.compare(parsed.subnet) !== 0) {
        errs.push(errors.invalidParam('subnet',
            constants.msg.NET_PROP_IMMUTABLE));
    }

    if (!network.fabric) {
        done();
        return;
    }

    IMMUTABLE_FABRIC_FIELDS.forEach(function (field) {
        if (parsed.hasOwnProperty(field)) {
            errs.push(errors.invalidParam(field,
                constants.msg.FABRIC_PROP_IMMUTABLE));
        }
    });

    done();
}


function validateAddressFamily(_opts, params, parsed, callback) {
    var subnetType;

    if (params.network) {
        subnetType = params.network.params.subnet.address().kind();
    } else if (parsed.subnet_start) {
        assert.object(parsed.subnet_start, 'parsed.subnet_start');
        assert.number(parsed.subnet_bits, 'parsed.subnet_bits');
        subnetType = parsed.subnet_start.kind();
    } else if (parsed.family) {
        subnetType = parsed.family;
    } else {
        callback(new Error('unable to determine subnet'));
        return;
    }

    var errs = [];
    var badResolvers = [];
    var badRoutes = [];
    var gateway = parsed.gateway || null;
    var provisionEnd = parsed.provision_end_ip || null;
    var provisionStart = parsed.provision_start_ip || null;
    var routes = parsed.routes || null;

    /*
     * Check that provisioning ranges match the subnet type. If they don't, then
     * we set the variable to null and skip later checks until we return all
     * validation problems.
     */
    if (provisionStart !== null && provisionStart.kind() !== subnetType) {
        errs.push(errors.invalidParam('provision_start_ip',
            constants.msg.PROV_START_TYPE_MISMATCH));
        provisionStart = null;
    }

    if (provisionEnd !== null && provisionEnd.kind() !== subnetType) {
        errs.push(errors.invalidParam('provision_end_ip',
            constants.msg.PROV_END_TYPE_MISMATCH));
        provisionEnd = null;
    }

    // check that provisioning ranges are same network type
    if (provisionStart !== null && provisionEnd !== null &&
        provisionStart.kind() !== provisionEnd.kind()) {
        errs.push(errors.invalidParam('provision_start_ip, provision_end_ip',
            constants.msg.PROV_TYPES_MISMATCH));
        provisionStart = null;
        provisionEnd = null;
    }

    // check if gateway is of same network type as the subnet
    if (gateway && gateway.kind() !== subnetType) {
        errs.push(errors.invalidParam('gateway',
            util.format(constants.SUBNET_GATEWAY_MISMATCH, subnetType)));

        gateway = null;
    }

    // check all resolvers for any of the wrong network type
    if (parsed.hasOwnProperty('resolvers')) {
        for (var rr in parsed.resolvers) {
            var resolver = parsed.resolvers[rr];
            if (resolver.kind() !== subnetType) {
                badResolvers.push(resolver.toString());
            }
        }
    }

    if (badResolvers.length > 0) {
        errs.push(errors.invalidParam('resolvers',
            util.format(constants.SUBNET_RESOLVER_MISMATCH, subnetType),
            { 'invalid': badResolvers }));
    }

    // check all of the routes for bad destinations and gateways
    if (routes !== null) {
        for (var route in routes) {
            var net =
                util_ip.toIPAddr(route) || util_ip.toSubnet(route);
            if (getKind(net) !== subnetType) {
                badRoutes.push(route);
            }
        }
    }

    if (badRoutes.length > 0) {
        errs.push(errors.invalidParam('routes',
            util.format(constants.SUBNET_ROUTE_DST_MISMATCH, subnetType),
            { 'invalid': badRoutes }));
    }

    callback(errs.length === 0 ? null : errs);
}


/**
 * Validates that all provision range params are present in an update request,
 * and if so validates the provision range.
 */
function validateProvisionRangeUpdate(opts, params, parsed, cb) {
    if (!parsed.hasOwnProperty('provision_start_ip') &&
        !parsed.hasOwnProperty('provision_end_ip') &&
        !parsed.hasOwnProperty('gateway')) {
        cb();
        return;
    }

    var toValidate = {
        vnet_id: params.network.params.vnet_id,
        subnet_bits: params.network.params.subnet_bits,
        subnet_start: params.network.params.subnet_start,
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
        fabric: opts.fabric,
        log: opts.log,
        owner_uuid: opts.owner_uuid,
        uuid: params.network.uuid
    }, null, toValidate, cb);
}

function validateSubnetAutoAlloc(opts, _, parsedParams, callback) {
    var errs = [];
    if (!opts.app.config.autoAllocSubnets) {
        errs.push(new errors.invalidParam('subnet_auto_alloc',
            'Subnet allocation is not enabled on this instance'));
        callback(errs);
        return;
    }
    if (parsedParams.subnet) {
        errs.push(new errors.invalidParam('subnet',
            'Manual allocation parameter not allowed'));
    }
    if (parsedParams.provision_start_ip) {
        errs.push(new errors.invalidParam('provision_start_ip',
            'Manual allocation parameter not allowed'));
    }
    if (parsedParams.provision_end_ip) {
        errs.push(new errors.invalidParam('provision_end_ip',
            'Manual allocation parameter not allowed'));
    }

    if (!parsedParams.family) {
        errs.push(new errors.missingParam('family'));
    }
    if (!parsedParams.subnet_prefix) {
        errs.push(new errors.missingParam('subnet_prefix'));
    }
    if (!parsedParams.vnet_id) {
        errs.push(new errors.missingParam('vnet_id'));
    }
    errors.sortErrsByField(errs);
    if (errs.length > 0) {
        callback(errs);
        return;
    }
    callback();
}

function validateSubnetParamsAlloc(_opts, _, parsedParams, callback) {
    var errs = [];
    if (parsedParams.subnet_alloc) {
        errs.push(new errors.invalidParam('subnet_alloc',
            'Auto allocation parameter not allowed'));
    }
    if (parsedParams.subnet_prefix) {
        errs.push(new errors.invalidParam('subnet_prefix',
            'Auto allocation parameter not allowed'));
    }
    if (!parsedParams.provision_start_ip) {
        errs.push(new errors.missingParam('provision_start_ip'));
    }
    if (!parsedParams.provision_end_ip) {
        errs.push(new errors.missingParam('provision_end_ip'));
    }
    if (!parsedParams.subnet) {
        errs.push(new errors.missingParam('subnet'));
    }
    errors.sortErrsByField(errs);
    if (errs.length > 0) {
        callback(errs);
        return;
    }
    callback();
}

/*
 * Validates that these two sets of params do not overlap:
 *
 *    [subnet, provision_start_ip, provision_end_ip]
 *    [subnet_alloc, family, subnet_prefix]
 *
 * Also validates that params.fabric = true and vnet_id = defined for
 * subnet_alloc path.
 */
function validateSubnetAlloc(opts, original, parsedParams, callback) {
    if (parsedParams.subnet_alloc) {
        validateSubnetAutoAlloc(opts, original, parsedParams, callback);
    } else {
        validateSubnetParamsAlloc(opts, original, parsedParams, callback);
    }
}

/**
 * Validates that:
 * * the provision start and end IPs are within the subnet
 * * the gateway IP is within the subnet
 * * that end doesn't come before start.
 */
function validateProvisionRange(opts, _, parsedParams, callback) {
    if (parsedParams.subnet_alloc || !parsedParams.subnet_start ||
        !parsedParams.subnet_bits || !parsedParams.provision_start_ip ||
        !parsedParams.provision_end_ip) {
        callback();
        return;
    }

    var errs = [];
    var gateway = parsedParams.gateway;
    var provisionEnd = parsedParams.provision_end_ip;
    var provisionStart = parsedParams.provision_start_ip;
    var subnetBits = parsedParams.subnet_bits;
    var subnetStart = parsedParams.subnet_start;
    var subnet = ipaddr.createCIDR(subnetStart, subnetBits);
    var subnetType = subnetStart.kind();

    assert.ok(subnet, 'subnet');
    parsedParams.subnet = subnet.toString();

    // check if provision range is within the subnet
    if (provisionStart !== null && !subnet.contains(provisionStart)) {
        errs.push(errors.invalidParam('provision_start_ip',
            constants.msg.PROV_START_IP_OUTSIDE));

        provisionStart = null;
        delete parsedParams.provision_start_ip;
    }
    if (provisionEnd !== null && !subnet.contains(provisionEnd)) {
        errs.push(errors.invalidParam('provision_end_ip',
            constants.msg.PROV_END_IP_OUTSIDE));

        provisionEnd = null;
        delete parsedParams.provision_end_ip;
    }

    // check if gateway is within the subnet
    if (gateway && !subnet.contains(gateway)) {
        errs.push(errors.invalidParam('gateway', constants.GATEWAY_SUBNET_MSG));

        gateway = null;
        delete parsedParams.gateway;
    }

    // IPv4-only checks - broadcast address is reserved
    if (provisionStart && provisionStart.kind() === 'ipv4' &&
        provisionStart.compare(subnet.broadcast()) === 0) {

        errs.push(errors.invalidParam('provision_start_ip',
            constants.msg.PROV_START_IP_BCAST));

        provisionStart = null;
        delete parsedParams.provision_start_ip;
    }
    if (provisionEnd && provisionEnd.kind() === 'ipv4' &&
        provisionEnd.compare(subnet.broadcast()) === 0) {

        errs.push(errors.invalidParam('provision_end_ip',
            constants.msg.PROV_END_IP_BCAST));

        provisionEnd = null;
        delete parsedParams.provision_end_ip;
    }

    // check if provision start is before provision end
    if (provisionStart && provisionEnd &&
        provisionStart.compare(provisionEnd) >= 0) {

        errs.push(errors.invalidParam('provision_end_ip',
                    constants.PROV_RANGE_ORDER_MSG));
        errs.push(errors.invalidParam('provision_start_ip',
                    constants.PROV_RANGE_ORDER_MSG));
    }

    if (errs.length !== 0) {
        callback(errs);
        return;
    }

    if (parsedParams.fabric) {
        if (subnetType === 'ipv4' && !util_ip.isRFC1918(subnet)) {
            callback(errors.invalidParam('subnet',
                constants.PRIV_RANGE_ONLY));
            return;
        }
        if (subnetType === 'ipv6' && !util_ip.isUniqueLocal(subnet)) {
            callback(errors.invalidParam('subnet',
                constants.PRIV_RANGE_ONLY));
            return;
        }
        if (subnetType !== 'ipv4') {
            callback(errors.invalidParam('subnet',
                constants.FABRIC_IPV4_ONLY));
            return;
        }
    } else {
        /**
         * For real (non-fabric) networks, allow overlapping IPv4 RFC1918 and
         * IPv6 Unique Local (private) networks. Unlike fabrics, where we can
         * check if there are actual overlapping issues for the given vnet_id,
         * a network operator could construct a number of private networks on
         * completely separate physical networks.
         */
        if (util_ip.isRFC1918(subnet) ||
            util_ip.isUniqueLocal(subnet)) {
            callback();
            return;
        }
    }

    // Finally, check for overlaps with existing networks.

    var sql, args;

    if (opts.fabric) {
        sql = fmt(OVERLAP_FABRIC_NET_SQL, BUCKET.name);
        args = [
            subnetStart.toString(),
            subnet.toString(),
            parsedParams.vnet_id
        ];
    } else {
        sql = fmt(OVERLAP_NORMAL_NET_SQL, BUCKET.name);
        args = [ subnetStart.toString(), subnet.toString() ];
    }

    opts.log.debug({
        sql: sql,
        args: args,
        subnet: subnet.toString()
    }, 'validateProvisionRange: finding overlapping subnets');

    var req = opts.app.moray.sql(sql, args);
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
        callback(err);
    });

    req.once('end', function () {
        if (overlapping.length !== 0) {
            callback(errors.networkOverlapParams(overlapping));
            return;
        }

        callback();
    });
}


/**
 * Validate a routes object
 */
function validateRoutes(opts, name, val, callback) {
    if (typeof (val) !== 'object' || util.isArray(val)) {
        callback(errors.invalidParam(name, constants.msg.OBJ));
        return;
    }

    var invalid = [];
    var routes = {};

    for (var r in val) {
        var badVals = [];
        var dst, key;

        dst = util_ip.toSubnet(r);
        if (dst === null) {
            dst = util_ip.toIPAddr(r);
        }

        if (dst === null) {
            badVals.push(r);
        }

        var gateway;
        if (opts.app.config.allowLinklocal && val[r] === 'linklocal') {
            gateway = val[r];
        } else {
            gateway = util_ip.toIPAddr(val[r]);
        }

        if (gateway === null) {
            badVals.push(val[r]);
        }

        if (badVals.length !== 0) {
            invalid.push(badVals);
            continue;
        }

        if (gateway !== 'linklocal' && gateway.kind() !== getKind(dst)) {
            callback(errors.invalidParam(name,
                constants.SUBNET_ROUTE_DST_NEXTHOP_MISMATCH,
                { invalid: [ dst.toString(), gateway.toString() ] }));
            return;
        }

        key = dst.toString();

        routes[key] = gateway;
    }

    if (invalid.length !== 0) {
        callback(errors.invalidParam(name,
            fmt('invalid route%s', invalid.length === 1 ? '' : 's'),
            { invalid: Array.prototype.concat.apply([], invalid) }));
        return;
    }

    var toReturn = {};
    toReturn[name] = routes;

    callback(null, null, toReturn);
}


/**
 * Validates parameters and returns a network object if all parameters are
 * valid, or an error otherwise
 */
function createNetworkObject(opts) {
    var params = opts.params;

    // If we're creating a new network, use strings to populate the
    // network's IP table.
    params.ip_use_strings = true;

    // Auto-assign gateway IP if internet_nat is requested but gateway
    // is unset.
    if (params.fabric && params.internet_nat && !params.gateway) {
        params.gateway = params.provision_start_ip;
    }

    return new Network(params);
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
        return getNetwork({
            app: opts.app,
            log: opts.log,
            params: { uuid: params.uuid }
        }, function (err, network) {
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
    var subnet_start = util_ip.toIPAddr(
        params.subnet_start || params.subnet_start_ip);

    assert.ok(subnet_start, 'subnet_start');

    var subnet = params.subnet ? ipaddr.createCIDR(params.subnet) :
        ipaddr.createCIDR(subnet_start, params.subnet_bits);

    assert.ok(subnet, 'subnet');

    // Note on address fields: Previously, addresses were stored as numbers in
    // moray, which only works for IPv4. Addresses are now sent as strings, and
    // indexed with Postgres' INET and CIDR types if necessary. The new format
    // is used with fields that end with _addr. Since we may be upgrading from
    // an older system, we check for attributes with _addr first, and then the
    // older IPv4 attributes.

    this.params = {
        fabric: params.fabric || false,
        ip_use_strings: params.ip_use_strings || false,
        nic_tag: params.nic_tag,
        provision_start_ip: util_ip.toIPAddr(
                params.provision_start_ip_addr || params.provision_start_ip),
        provision_end_ip: util_ip.toIPAddr(
                params.provision_end_ip_addr || params.provision_end_ip),
        subnet: subnet,
        subnet_start: subnet_start,
        subnet_type: subnet_start.kind(),
        subnet_bits: subnet.prefixLength(),
        uuid: params.uuid,
        vlan_id: Number(params.vlan_id),
        mtu: Number(params.mtu) || constants.MTU_DEFAULT
    };

    this.etag = params.etag || null;

    if (params.hasOwnProperty('name_str')) {
        // The name property has a prefix on it to establish per-user
        // uniqueness for fabrics - see nameStr() above for details
        this.params.name =
            params.name_str.substr(params.name_str.indexOf(':') + 1);
    } else {
        this.params.name = params.name;
    }

    if (params.hasOwnProperty('internet_nat')) {
        this.params.internet_nat = params.internet_nat;
    } else {
        this.params.internet_nat = true;
    }

    if (!params.uuid) {
        this.params.uuid = UUID.v4();
    }

    var gateway = params.gateway_addr || params.gateway;
    if (gateway) {
        this.params.gateway = util_ip.toIPAddr(gateway);
    }

    if (params.hasOwnProperty('attached_networks')) {
        this.params.attached_networks = params.attached_networks;
    }

    var routes = params.route_addrs || params.routes;
    if (routes) {
        this.params.routes = {};
        for (var r in routes) {
            var key;
            if (r.toString().indexOf('/') >= 0) {
                key = util_ip.toSubnet(r).toString();
            } else {
                key = util_ip.toIPAddr(r).toString();
            }

            // Fixup old route gateways that didn't get serialized.
            this.params.routes[key] = routes[r] === 'linklocal'
                ? routes[r]
                : util_ip.fixupIPAddr(routes[r]);
        }
    }

    if (params.hasOwnProperty('owner_uuids_arr')) {
        this.params.owner_uuids = params.owner_uuids_arr;
        // XXX: need to check if it's empty here?

    } else if (params.hasOwnProperty('owner_uuids')) {
        this.params.owner_uuids = params.owner_uuids;
        mod_moray.valToArray(this.params, 'owner_uuids');
        if (this.params.owner_uuids && this.params.owner_uuids.length === 0) {
            delete this.params.owner_uuids;
        }
    }

    if (params.hasOwnProperty('description')) {
        this.params.description = params.description;
    }

    var resolvers = params.resolver_addrs || params.resolvers;
    if (resolvers) {
        this.params.resolvers =
            util_common.arrayify(resolvers).map(util_ip.toIPAddr);
    }

    if (params.fabric) {
        if (params.gateway) {
            this.params.gateway_provisioned =
                params.gateway_provisioned || false;
        }

        if (params.hasOwnProperty('vnet_id')) {
            this.params.vnet_id = params.vnet_id;
        }
    }

    this.provisionMax = this.params.provision_end_ip;
    this.provisionMin = this.params.provision_start_ip;
    this.subnetBits = this.params.subnet_bits;
    this.subnetStart = this.params.subnet_start;
    this.subnet = this.params.subnet;


    // XXX: rename this something different!?
    this.fabric = params.fabric || false;

    if (params.fields) {
        this.fields = params.fields;
    }

    Object.seal(this);
}

Object.defineProperty(Network.prototype, 'gateway_provisioned', {
    get: function () { return this.params.gateway_provisioned; },
    set: function (val) { this.params.gateway_provisioned = val; }
});

Object.defineProperty(Network.prototype, 'nic_tag', {
    get: function () { return this.params.nic_tag; }
});

Object.defineProperty(Network.prototype, 'ip_use_strings', {
    get: function () { return this.params.ip_use_strings; }
});

Object.defineProperty(Network.prototype, 'family', {
    get: function () { return this.params.subnet_type; }
});

Object.defineProperty(Network.prototype, 'mtu', {
    get: function () { return this.params.mtu; }
});

Object.defineProperty(Network.prototype, 'uuid', {
    get: function () { return this.params.uuid; }
});

Object.defineProperty(Network.prototype, 'vnet_id', {
    get: function () { return this.params.vnet_id; }
});

Object.defineProperty(Network.prototype, 'vlan_id', {
    get: function () { return this.params.vlan_id; }
});


/**
 * Raw form suitable for adding to a moray batch
 */
Network.prototype.batch = function networkBatch(opts) {
    return {
        bucket: BUCKET.name,
        key: this.params.uuid,
        operation: 'put',
        value: this.raw(opts),
        options: {
            etag: this.etag
        }
    };
};


/**
 * Returns the raw form suitable for storing in moray
 */
Network.prototype.raw = function networkRaw(_) {
    var raw = {
        fabric: this.params.fabric,
        internet_nat: this.params.internet_nat,
        ip_use_strings: this.params.ip_use_strings,
        mtu: this.params.mtu,
        name_str: nameStr(this.params),
        provision_end_ip_addr:
            this.params.provision_end_ip.toString(),
        provision_start_ip_addr:
            this.params.provision_start_ip.toString(),
        subnet_start: this.params.subnet_start.toString(),
        subnet_bits: this.params.subnet_bits,
        subnet: this.subnet.toString(),
        subnet_type: this.params.subnet_type,
        nic_tag: this.params.nic_tag,
        uuid: this.params.uuid,
        v: BUCKET.version,
        vlan_id: this.params.vlan_id
    };

    /*
     * We only care about writing this deprecated field when we have
     * a "global" network. Since "name" is unique, we don't want to
     * put people's conflicting fabric names here.
     */
    if (!this.params.fabric) {
        raw.name = this.params.name;
    }

    // Backward-compatibility (for rollback)
    if (this.params.subnet_type === 'ipv4') {
        raw.provision_end_ip = this.params.provision_end_ip.toLong();
        raw.provision_start_ip = this.params.provision_start_ip.toLong();
        raw.subnet_start_ip = this.params.subnet_start.toLong();
        raw.subnet_end_ip = raw.subnet_start_ip +
            Math.pow(2, 32 - raw.subnet_bits) - 1;
    }

    if (this.params.gateway) {
        raw.gateway_addr = this.params.gateway.toString();

        if (this.params.subnet_type === 'ipv4') {
            raw.gateway = this.params.gateway.toLong();
        }

        if (this.params.fabric) {
            raw.gateway_provisioned = this.params.gateway_provisioned;
        }
    }

    if (this.params.hasOwnProperty('owner_uuids')) {
        raw.owner_uuids = mod_moray.arrayToVal(this.params.owner_uuids);
        raw.owner_uuids_arr = this.params.owner_uuids;
    }

    if (this.params.hasOwnProperty('resolvers')) {
        raw.resolver_addrs = this.params.resolvers.map(function (r) {
            return r.toString();
        });

        // Rollback-compatibility:
        if (this.params.subnet_type === 'ipv4') {
            raw.resolvers = this.params.resolvers.map(function (r) {
                return r.toLong();
            });
        }
    }

    if (this.params.hasOwnProperty('routes')) {
        raw.route_addrs = serializeRoutes(this.params.routes);

        if (this.params.subnet_type === 'ipv4') {
            raw.routes = routeNumbers(this.params.routes);
        }
    }

    if (this.params.hasOwnProperty('description')) {
        raw.description = this.params.description;
    }

    if (this.params.fabric) {
        raw.vnet_id = this.params.vnet_id;
    }

    return raw;
};



/**
 * Returns the serialized form of the network (returned by the API)
 */
Network.prototype.serialize = function networkSerialize(opts) {
    var fabricDisplay = (opts && opts.fabric) || false;
    var fieldsSer = {};

    var ser = {
        family: this.family,
        mtu: this.params.mtu,
        nic_tag: this.params.nic_tag,
        name: this.params.name,
        provision_end_ip: this.params.provision_end_ip.toString(),
        provision_start_ip: this.params.provision_start_ip.toString(),
        subnet: this.subnet.toString(),
        uuid: this.params.uuid,
        vlan_id: this.params.vlan_id
    };

    if (this.fabric) {
        ser.fabric = true;
        if (this.params.hasOwnProperty('vnet_id')) {
            ser.vnet_id = this.params.vnet_id;
        }

        if (this.params.hasOwnProperty('internet_nat')) {
            ser.internet_nat = this.params.internet_nat;
        }

        if (this.params.gateway) {
            ser.gateway_provisioned = this.params.gateway_provisioned;
        }
    }

    if (this.params.resolvers) {
        ser.resolvers = this.params.resolvers.map(function (r) {
            return r.toString();
        });
    } else {
        ser.resolvers = [];
    }

    if (this.params.gateway) {
        ser.gateway = this.params.gateway.toString();
    }

    if (this.params.attached_networks) {
        ser.attached_networks =
            serializeAttachedNetworks(this.params.attached_networks);
    }

    if (this.params.routes) {
        ser.routes = serializeRoutes(this.params.routes);
    }

    if (this.params.description) {
        ser.description = this.params.description;
    }

    if (this.params.owner_uuids) {
        if (fabricDisplay) {
            ser.owner_uuid = this.params.owner_uuids[0];
        } else {
            ser.owner_uuids = this.params.owner_uuids;
        }
    }

    // IPv4 Only
    if (this.family === 'ipv4') {
        ser.netmask = util_ip.bitsToNetmask(this.params.subnet_bits);
    }

    if (this.fields) {
        for (var f in this.fields) {
            if (ser.hasOwnProperty(this.fields[f])) {
                fieldsSer[this.fields[f]] = ser[this.fields[f]];
            }
        }

        return fieldsSer;
    }

    return ser;
};



/**
 * Returns whether or not a UUID is an owner of the network.
 *
 * The "admin" user is allowed to provision on all networks and pools,
 * to allow provisioning appliance zones like fabric NATs and volumes
 * without having to be an owner.
 */
Network.prototype.isOwner = function networkHasOwner(owner) {
    if (!this.params.hasOwnProperty('owner_uuids') ||
        this.params.owner_uuids.length === 0) {
        return true;
    }

    return (this.params.owner_uuids.concat(
        constants.UFDS_ADMIN_UUID).indexOf(owner) !== -1);
};


/**
 * Check whether the properties of this network match under the given
 * intersection. Fields that get checked are:
 *
 * - "mtu"
 * - "nic_tag"
 * - "vlan_id"
 * - "vnet_id"
 *
 * See lib/util/intersect.js for more information.
 */
Network.prototype.matches = function matchesIntersection(intersection) {
    for (var prop in intersection) {
        if (this[prop] !== intersection[prop]) {
            return false;
        }
    }

    return true;
};

/*
 * Hits the napi_networks bucket, and filters the results according to 'filter'
 * which is a string.
 */
function listFilteredNetworks(opts, filter, attr, callback) {
    var app = opts.app;
    var log = opts.log;

    mod_moray.listObjs({
        defaultFilter: '(uuid=*)',
        filter: filter,
        log: log,
        bucket: BUCKET,
        model: Network,
        limit: opts.limit,
        moray: app.moray,
        sort: {
            attribute: attr,
            order: 'ASC'
        }
    }, callback);
}

/*
 * Add an additional boolean expression to the filter, that includes only all
 * subnets that appear after 'marker'.
 */
function addSubnetMarkerToFilter(filter, marker) {
    if (marker) {
        return '(&' + filter + '!(subnet<=' + marker + '))';
    }
    return filter;
}

/*
 * Wraps listFilteredNetworks in a LOMStream. Looks at 10 networks at a time.
 */
function listFilteredNetworksStream(opts, baseFilter, marker, attr) {
    var dupOpts = jsprim.deepCopy(opts);
    var filter;

    var s = new lomstream.LOMStream({
        fetch: function (opts2, lobj, _datacb, cb) {
            var copyOpts = jsprim.deepCopy(opts2);
            copyOpts.limit = lobj.limit;
            filter = addSubnetMarkerToFilter(baseFilter, lobj.marker);

            listFilteredNetworks(copyOpts, filter, attr, function (err, nets) {
                if (err) {
                    cb(err);
                    return;
                }

                cb(null, { done: nets.length === 0, results: nets });
                return;
            });
        },
        marker: marker,
        limit: 10,
        fetcharg: dupOpts
    });
    return s;
}


function allocateSubnets(opts, callback) {
    var filter = '(vnet_id=' + opts.params.vnet_id + ')';


    var subnetStream = listFilteredNetworksStream(opts, filter, getMarkerSubnet,
        'subnet');
    subnetStream.on('error', callback);

    var pairStream = new mod_subnet_streams.SubnetPairStream();
    var availableSubnetStream =
        new mod_subnet_streams.AvailableSubnetStream(opts);

    callback(null, subnetStream.pipe(pairStream).pipe(availableSubnetStream));
}


// --- Exported functions



/**
 * Creates a new network
 *
 * @param opts {Object}:
 * - app {App}
 * - log {Log}
 * - params {Object}:
 *   - `name` {String}: network name (required)
 *   - `gateway` {IP}: gateway
 *   - `nic_tag` {String}: nic tag name (required)
 *   - `provision_start_ip` {IP}: start address for provision range (required)
 *   - `provision_end_ip` {IP}: end address for provision range (required)
 *   - `resolvers` {IP Array}: DNS resolvers
 *   - `vlan_id` {Number}: VLAN ID (required)
 *   - `mtu` {Number}: MTU value
 * @param callback {Function} `function (err, netObj)`
 */
function createNetwork(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var network;
    var params = opts.params;
    var validatedParams;
    var copts = {
        app: app,
        fabric: opts.fabric,
        log: log,
        owner_uuid: opts.owner_uuid
    };

    log.debug(params, 'createNetwork: entry');

    vasync.pipeline({
        funcs: [
        function _validateHttpParams(_, cb) {
            validate.params(CREATE_SCHEMA, copts, opts.params,
                function (err, validParams) {
                    if (err) {
                        cb(err);
                        return;
                    }
                    validatedParams = validParams;
                    cb();
            });
        },
        function _allocateSubnet(_, cb) {
            if (!validatedParams.subnet_alloc) {
                cb();
                return;
            }
            allocateSubnets(opts, function (err, subnet_stream) {
                /*
                 * Note that the subnet_stream is lazy by default, it does not
                 * need an explicit pause-call. We only get data if we call
                 * read(). If we bail out of this pipeline-phase via a call to
                 * cb(), we will end up orphaning the subnet_stream, which will
                 * get GC'd in the future.
                 */
                if (err) {
                    cb(err);
                    return;
                }

                function done(err2) {
                    subnet_stream.removeListener('readable', onReadable);
                    subnet_stream.removeListener('error', onError);
                    subnet_stream.removeListener('end', onEnd);
                    cb(err2);
                }

                function onReadable() {
                    var subnet = subnet_stream.read(1);
                    /*
                     * Wait until next readable.
                     */
                    if (subnet === null) {
                        return;
                    }
                    validatedParams.subnet_start = subnet.address();
                    validatedParams.subnet_bits = subnet.prefixLength();
                    var provrange = autoalloc.allocProvisionRange(subnet);
                    validatedParams.provision_start_ip = provrange[0];
                    validatedParams.provision_end_ip = provrange[1];
                    done();
                }

                function onError(err2) {
                    done(err2);
                }

                function onEnd() {
                    done(new errors.SubnetsExhaustedError());
                }

                subnet_stream.on('error', onError);
                subnet_stream.on('readable', onReadable);
                subnet_stream.on('end', onEnd);
            });
        },

        function _createNetObj(_, cb) {
            var vopts = {
                app: app,
                fabric: opts.fabric,
                log: log,
                owner_uuid: opts.owner_uuid,
                params: validatedParams
            };
            network = createNetworkObject(vopts);
            return cb();
        },


        function _createNet(_, cb) {
            var raw = network.raw();
            log.debug({ uuid: network.uuid, raw: raw },
                'createNetwork: creating moray record');

            app.moray.putObject(BUCKET.name, network.uuid, raw, { etag: null },
                function (err, res) {
                if (err) {
                    log.error(err, 'Error creating network');

                    if (VError.hasCauseWithName(err, 'UniqueAttributeError')) {
                        // name_str is the only unique parameter in this bucket
                        // right now, so it was the culprit
                        return cb(new errors.InvalidParamsError(
                            constants.msg.NET_NAME_IN_USE,
                            [ errors.duplicateParam('name') ]));
                    }

                    return cb(err);
                }

                network.etag = res.etag;

                return cb();
            });
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
                if (network.fabric && !network.params.internet_nat &&
                        network.params.owner_uuids) {
                    ipsToCreate[network.params.gateway.toString()] =
                        userReservedIP(network, network.params.gateway,
                            network.params.owner_uuids[0]);
                } else {
                    ipsToCreate[network.params.gateway.toString()] =
                        adminReservedIP(network, network.params.gateway,
                            app.config.ufdsAdminUuid);
                }
            }

            for (var r in network.params.resolvers) {
                var num = network.params.resolvers[r];
                if (network.subnet.contains(num) &&
                    !ipsToCreate.hasOwnProperty(num.toString())) {

                    ipsToCreate[num.toString()] = adminReservedIP(network, num,
                        app.config.ufdsAdminUuid);
                }
            }

            // IPv4 only: Don't allow provisioning on the broadcast address.
            if (network.family === 'ipv4') {
                var maxIP = network.subnet.broadcast();
                if (!ipsToCreate.hasOwnProperty(maxIP.toString())) {
                    ipsToCreate[maxIP.toString()] = adminReservedIP(network,
                        maxIP, app.config.ufdsAdminUuid);
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
                    ipsToCreate[rangeNum] = placeholderIP(network, rangeNum);
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
 * - `attached_networks` {Array of UUIDs}: networks capable of routing to
 * - `mtu` {Number}: MTU for the network
 * @param callback {Function} `function (err, updatedNetworkObj)`
 */
function updateNetwork(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;

    log.debug(params, 'updateNetwork: entry');

    var uopts = {
        app: app,
        fabric: opts.fabric,
        log: log,
        network: params.network,
        owner_uuid: opts.owner_uuid
    };

    validate.params(UPDATE_SCHEMA, uopts, params, function (err, validated) {
        if (err) {
            return callback(err);
        }

        var batch = [ {
            bucket: BUCKET.name,
            key: params.uuid,
            operation: 'put',
            value: params.network.raw()
        } ];

        var isIPv4 = params.network.family === 'ipv4';

        // -- moray-only values

        ['description', 'mtu', 'ip_use_strings'].forEach(function (p) {
            if (validated.hasOwnProperty(p)) {
                batch[0].value[p] = validated[p].toString();
            }
        });

        ['provision_start_ip', 'provision_end_ip'].forEach(function (p) {
            if (validated.hasOwnProperty(p)) {
                var p_addr = p + '_addr';
                var addr = validated[p];
                batch[0].value[p_addr] = addr.toString();

                // Backward-compatibility (for rollback)
                if (isIPv4) {
                    batch[0].value[p] = addr.toLong();
                }
            }
        });

        if (validated.hasOwnProperty('name')) {
            batch[0].value.name = validated.name.toString();
            batch[0].value.name_str = nameStr(batch[0].value);
        }

        if (validated.hasOwnProperty('owner_uuids')) {
            batch[0].value.owner_uuids =
                mod_moray.arrayToVal(validated.owner_uuids);
            batch[0].value.owner_uuids_arr = validated.owner_uuids;
            if (validated.owner_uuids.length === 0) {
                delete batch[0].value.owner_uuids;
                delete batch[0].value.owner_uuids_arr;
            }
        }

        // -- values that require a workflow

        if (validated.hasOwnProperty('gateway')) {
            if (!validated.gateway) {
                delete batch[0].value.gateway;
            } else {
                batch[0].value.gateway_addr = validated.gateway.toString();

                // Backward-compatibility (for rollback)
                if (isIPv4) {
                    batch[0].value.gateway = validated.gateway.toLong();
                }
            }

            validated._gatewayIP.reserved = true;
            batch.push(validated._gatewayIP.batch());
        }

        if (validated.hasOwnProperty('resolvers')) {
            var resolvers = validated.resolvers.map(function (r) {
                return r.toString();
            });

            batch[0].value.resolver_addrs = resolvers;

            if (isIPv4) {
                batch[0].value.resolvers = validated.resolvers.map(
                    function (r) { return r.toLong(); });
            }
        }

        // XXX move this into the attached_networks step
        if (validated.hasOwnProperty('routes')) {
            batch[0].value.route_addrs = serializeRoutes(validated.routes);

            if (isIPv4) {
                batch[0].value.routes = routeNumbers(validated.routes);
            }
        }

        vasync.pipeline({ funcs: [
            function getCurrentAttachedNetworks(_, cb) {
                if (!params.network.fabric) {
                    cb();
                    return;
                }
                var vnetOpts = {
                    log: log,
                    moray: app.moray,
                    net_uuid: params.network.uuid
                };

                mod_portolan_moray.vnetRouteList(vnetOpts,
                    function onRouteList(routeListErr, routes) {
                    if (routeListErr) {
                        cb(routeListErr);
                        return;
                    }
                    batch[0].value.attached_networks = routes;
                    cb();
                });
            },
            function rangeUpdates(_, cb) {
                provisionRangeUpdates(app, log, params.network, validated,
                    function (pruErr, updates) {
                    if (pruErr) {
                        cb(pruErr);
                        return;
                    }

                    if (updates && updates.length !== 0) {
                        batch = batch.concat(updates);
                    }

                    cb();
                });
            },
            function handleAttachedNetworks(_, cb) {
                // MIKE handle joining or removing attached networks
                // Check for attached_networks update or return early
                if (!params.network.fabric ||
                    !validated.hasOwnProperty('attached_networks')) {
                    cb();
                    return;
                }
                provisionAttachedNetworkUpdates(app, log, batch[0].value,
                    validated.attached_networks,
                    function onAttUpdate(attachedErr, result) {
                    if (attachedErr) {
                        cb(attachedErr);
                        return;
                    }

                    // We need to loop over the batch and populate
                    // attached_networks since we already looked up that field
                    // earlier
                    result.batch.forEach(function eachBatchAction(b) {
                        var network = batch[0].value;

                        if (network.uuid === b.value.net_uuid) {
                            return;
                        }

                        if (b.operation === 'put') {
                            network.attached_networks.push(b.value);
                        }
                        // MIKE todo handle removing
                    });
                    batch = batch.concat(result.batch);
                    cb();
                });
            }
        ] }, function applyUpdate(pErr, results) {
            if (pErr) {
                callback(pErr);
                return;
            }

            app.moray.batch(batch, function (bErr, res) {
                if (bErr) {
                    callback(bErr);
                    return;
                }

                var toReturn = new Network(batch[0].value);
                toReturn.etag =
                    util_common.getEtag(res.etags, BUCKET.name, toReturn.uuid);

                callback(null, toReturn);
            });

        });
    });
}


function validateListNetworks(params, callback) {
    validate.params(LIST_SCHEMA, null, params, callback);
}



/**
 * Lists networks, filtering by parameters
 */
function listNetworks(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var offset, limit;

    validateListNetworks(opts.params, function (err, params) {
        var ownerUUID;
        var provisionableBy;

        if (err) {
            return callback(err);
        }
        ownerUUID = params.owner_uuid;
        provisionableBy = params.provisionable_by;

        if (params.offset) {
            offset = Number(params.offset);
            delete params.offset;
        }

        if (params.limit) {
            limit = Number(params.limit);
            delete params.limit;
        }

        if (params.family) {
            params.subnet_type = params.family;
            delete params.family;
        }

        if (provisionableBy) {
            // Match both networks with that owner_uuid as well as no owner_uuid
            params.owner_uuids_arr = [ provisionableBy, '!*' ];
        }

        if (ownerUUID) {
            // Match only networks with that owner_uuid
            params.owner_uuids_arr = ownerUUID;
        }

        if (ownerUUID || provisionableBy) {
            delete params.owner_uuid;
            delete params.owner_uuids;
            delete params.provisionable_by;
        }

        if (params.name) {
            var nameStrs = [];
            var names = util.isArray(params.name) ? params.name :
                [ params.name ];

            names.forEach(function (name) {
                var globalName = 'global:' + name;

                if (provisionableBy) {
                    if (params.fabric) {
                        nameStrs.push(provisionableBy + ':' + name);
                    } else {
                        nameStrs.push(globalName);
                        nameStrs.push(provisionableBy + ':' + params.name);
                    }

                } else {
                    if (params.fabric) {
                        nameStrs.push('*:' + params.name);
                    } else {
                        nameStrs.push(globalName);
                    }
                }
            });

            params.name_str = nameStrs.length === 1 ? nameStrs[0] : nameStrs;
            delete params.name;
        }

        mod_moray.listObjs({
            defaultFilter: '(uuid=*)',
            filter: params,
            limit: limit,
            log: log,
            offset: offset,
            bucket: BUCKET,
            model: Network,
            moray: app.moray,
            sort: {
                attribute: 'name',
                order: 'ASC'
            }
        }, callback);

    });
}

/**
 * Internal function used to generate a fetch request for listNetworks.
 */
function listNetworksFetch(opts, lobj, _datacb, callback) {
    var copyOpts;

    assert.object(lobj);
    assert.number(lobj.offset);
    assert.number(lobj.limit);
    assert.object(opts.params);

    copyOpts = jsprim.deepCopy(opts);
    copyOpts.params.limit = lobj.limit;
    copyOpts.params.offset = lobj.offset;

    listNetworks(copyOpts, function (err, nets) {
        var done = false;

        if (err) {
            return callback(err);
        }

        if (nets.length === 0) {
            done = true;
        }

        return callback(null, { done: done, results: nets });
    });
}

/**
 * Creates an internal stream that can be used to list networks. Note that this
 * should only ever be used internally by NAPI and should not be the basis for a
 * public API interface. Those instead should remain based on the underlying
 * moray queries and be limited based on limit, offset, and marker.
 */
function listNetworksStream(opts, callback) {

    validateListNetworks(opts.params, function (err, params) {
        var s, dupOpts;

        if (err) {
            return callback(err);
        }
        dupOpts = jsprim.deepCopy(opts);
        dupOpts.params = params;

        s = new lomstream.LOMStream({
            fetch: listNetworksFetch,
            limit: constants.DEFAULT_LIMIT,
            offset: true,
            fetcharg: dupOpts
        });

        return callback(null, s);
    });
}


/**
 * Gets a network
 */
function getNetwork(opts, callback) {
    var app = opts.app;
    var log = opts.log;
    var params = opts.params;
    assert.ok(app, 'app');
    assert.ok(log, 'log');
    assert.ok(params, 'params');

    log.debug(params, 'getNetwork: entry');

    validate.params(GET_SCHEMA, null, params, function (valErr, validated) {
        if (valErr) {
            return callback(valErr);
        }

        if (validated.uuid === 'admin') {
            // Special case for booter - it's allowed to get the admin network
            // by name
            return mod_moray.listObjs({
                filter: '(name_str=global:admin)',
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

                return returnNetworkIfOwner(validated, list[0], callback);
            });
        }

        // XXX MIKE: Lets add the raw attached_networks output in params
        mod_moray.getObj(app.moray, BUCKET, validated.uuid,
                function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            rec.value.etag = rec._etag;
            log.debug({ raw: rec.value }, 'got network');

            if (validated.fields) {
                rec.value.fields = validated.fields;
            }

            if (rec.value.fabric) {
                var vnetOpts = {
                    log: log,
                    moray: app.moray,
                    net_uuid: validated.uuid
                };
                mod_portolan_moray.vnetRouteList(vnetOpts,
                    function onRouteList(routeListErr, routes) {
                    if (routeListErr) {
                        return callback(routeListErr);
                    }
                    if (routes) {
                        log.debug({ attached_networks: routes},
                            'got attached_networks');
                        rec.value.attached_networks = routes;
                    }
                    return returnNetworkIfOwner(validated,
                        new Network(rec.value), callback);
                });
            } else {
                return returnNetworkIfOwner(validated, new Network(rec.value),
                        callback);
            }
        });
    });
}


/**
 * Deletes a network
 */
function deleteNetwork(opts, callback) {
    assert.object(opts, 'opts');
    assert.object(opts.existingNet, 'opts.existingNet');

    var app = opts.app;
    var log = opts.log;
    var params = opts.params;

    log.debug(params, 'deleteNetwork: entry');

    vasync.pipeline({ funcs: [
        function checkNetNICs(_, cb) {
            mod_nic_list({
                app: app,
                log: log,
                params: {
                    network_uuid: params.uuid
                }
            }, function (listErr, results) {
                if (listErr) {
                    cb(listErr);
                    return;
                }

                if (results.length === 0) {
                    cb();
                    return;
                }

                cb(new errors.InUseError(constants.msg.NIC_ON_NET,
                    results.map(nicUsedByError).sort(errors.sortById)));
            });
        },
        function deleteNet(_, cb) {
            app.moray.delObject(BUCKET.name, params.uuid, {
                etag: opts.existingNet.etag
            }, cb);
        },
        function deleteNetBucket(_, cb) {
            var bucketName = mod_ip.bucketName(params.uuid);
            app.moray.delBucket(bucketName,
                function postBucketDel(err) {
                if (err &&
                    VError.hasCauseWithName(err, 'BucketNotFoundError')) {
                    cb();
                    return;
                }

                cb(err);
            });
        }
    ] }, callback);
}


/**
 * Finds networks that contain the specified IP using the provided nic_tag
 * and vlan_id. This function calls the callback with an array of UUIDs for
 * all matching networks.
 */
function findContainingNetworks(opts, vlan_id, nic_tag, vnet_id, ip, callback) {
    assert.object(opts, 'opts');
    assert.number(vlan_id, 'vlan_id');
    assert.string(nic_tag, 'nic_tag');
    assert.optionalNumber(vnet_id, 'vnet_id');
    assert.object(ip, 'ip');
    assert.func(callback, 'callback');

    var sql = util.format(CONTAINING_NET_SQL, BUCKET.name);
    var args = [ ip.toString(), vlan_id, nic_tag ];

    if (vnet_id !== undefined && vnet_id !== null) {
        sql += ' AND vnet_id = $4';
        args.push(vnet_id);
    }

    var req = opts.app.moray.sql(sql, args);
    var uuids = [];
    req.on('record', function (r) {
        uuids.push(r.uuid);
    });
    req.on('error', callback);
    req.on('end', function () {
        callback(null, uuids);
    });
}


/**
 * Initializes the networks bucket
 */
function initNetworksBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


/**
 * Cache constructed and used during requests that may need to look up
 * the same network multiple times (e.g., a NIC that is provisioning
 * several addresses on the same network).
 */
function NetworkCache(app, log) {
    this._cache = {};
    this.app = app;
    this.log = log;

    Object.seal(this);
}


NetworkCache.prototype.get = function getFromCache(uuid, callback) {
    var self = this;
    if (self._cache.hasOwnProperty(uuid)) {
        callback(null, self._cache[uuid]);
        return;
    }

    var params = { app: self.app, log: self.log, params: { uuid: uuid } };
    getNetwork(params, function saveToCache(err, res) {
        if (err) {
            callback(err);
            return;
        }

        self._cache[uuid] = res;
        callback(null, res);
    });
};


module.exports = {
    bucket: function () { return BUCKET; },
    create: createNetwork,
    del: deleteNetwork,
    get: getNetwork,
    init: initNetworksBucket,
    findContaining: findContainingNetworks,
    list: listNetworks,
    listNetworksStream: listNetworksStream,
    NetworkCache: NetworkCache,
    update: updateNetwork,
    Network: Network
};

/*
 * Circular dependencies 'require'd here. DON'T ASK QUESTIONS.
 */
mod_nicTag = require('./nic-tag');
mod_nic_list = require('./nic/list').list;
