/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * The Networking API control application
 */

var assert = require('assert');
var bunyan = require('bunyan');
var format = require('util').format;
var fs = require('fs');
var mod_config = require('./config');
var mod_nicTag = require('./models/nic-tag');
var NAPI = require('sdc-clients').NAPI;
var nopt = require('nopt');
var path = require('path');
var restify = require('restify');
var util_common = require('./util/common');
var UUID = require('node-uuid');


var VERBOSE = false;
var DEBUG = false;
var LONG_OPTS = {
    'verbose': Boolean,
    'debug': Boolean
};
var SHORT_OPTS = {
    'v': '--verbose',
    'd': '--debug'
};
var ROUTES_MSG = 'Invalid routes format: must be a comma-separated list of '
    + 'destination:gateway pairs\n';


/*
 * Main entry point
 */
function main() {
    var parsedOpts = nopt(LONG_OPTS, SHORT_OPTS, process.argv, 2);
    var command = parsedOpts.argv.remain[0];
    if (parsedOpts.verbose)
        VERBOSE = true;
    if (parsedOpts.debug)
        DEBUG = true;

    var config = mod_config.load(
        path.normalize(__dirname + '/../config.json'));
    var napi = new NAPI({
        agent: false,
        url: 'http://localhost:' + config.port
    });

    switch (command) {
    // Debugging
    case 'ping':
        napi.ping(standardHandler);
        break;
    // Nics
    case 'nic-list':
        listNics(napi, parsedOpts);
        break;
    case 'nics':
        getNics(napi, parsedOpts);
        break;
    case 'nic-get':
        getNic(napi, parsedOpts);
        break;
    case 'nic-delete':
        deleteNic(napi, parsedOpts);
        break;
    case 'nic-update':
        updateNic(napi, parsedOpts);
        break;
    case 'nic-provision':
        provisionNic(napi, parsedOpts);
        break;
    case 'nic-create':
        createNic(napi, parsedOpts);
        break;
    // Networks
    case 'network-list':
        listNetworks(napi, parsedOpts);
        break;
    case 'network-get':
        getNetwork(napi, parsedOpts);
        break;
    case 'network-create':
        createNetwork(napi, parsedOpts);
        break;
    case 'network-update':
        updateNetwork(napi, parsedOpts);
        break;
    case 'network-delete':
        deleteNetwork(napi, parsedOpts);
        break;
    // IPs
    case 'ip-list':
        listIPs(napi, parsedOpts);
        break;
    case 'ip-get':
        getIP(napi, parsedOpts);
        break;
    case 'ip-update':
        updateIP(napi, parsedOpts);
        break;
    // Nic Tags
    case 'nictag-list':
        listNicTags(napi, parsedOpts);
        break;
    case 'nictag-create':
        createNicTag(napi, parsedOpts);
        break;
    case 'nictag-get':
        getNicTag(napi, parsedOpts);
        break;
    case 'nictag-update':
        updateNicTag(napi, parsedOpts);
        break;
    case 'nictag-delete':
        deleteNicTag(napi, parsedOpts);
        break;
    // Network Pools
    case 'networkpool-list':
        listNetworkPools(napi, parsedOpts);
        break;
    case 'networkpool-create':
        createNetworkPool(napi, parsedOpts);
        break;
    case 'networkpool-get':
        getNetworkPool(napi, parsedOpts);
        break;
    case 'networkpool-update':
        updateNetworkPool(napi, parsedOpts);
        break;
    case 'networkpool-delete':
        deleteNetworkPool(napi, parsedOpts);
        break;
    default:
        usage();
        break;
    }
}



// --- Utility functions



/*
 * Nicely formats a JSON object
 */
function json(obj) {
    return JSON.stringify(obj, null, 2);
}


/*
 * Generic handler for callbacks: prints out an error if there is one,
 * stringifies the JSON otherwise.
 */
function standardHandler(err, obj, req, res) {
    if (err) {
        return console.log(json(err));
    }

    if (VERBOSE) {
        if (obj.hasOwnProperty('statusCode')) {
            obj.statusCode = res.statusCode;
        }

        if (obj.hasOwnProperty('code')) {
            obj.code = res.code;
        }
    }

    return console.log(json(obj));
}


/**
 * Transform network params into the form expected by NAPI
 */
function formatNetworkParams(params) {
    if (!params) {
        return;
    }

    if (params.hasOwnProperty('routes')) {
        var routesObj = {};
        var routes = util_common.arrayify(params.routes);

        if (routes.length === 0) {
            // Allow unsetting all routes with "routes="
            params.routes = {};
            return;
        }

        routes.forEach(function (pair) {
            var kv = pair.split(':');
            if (kv.length !== 2) {
                exit(ROUTES_MSG);
            }

            routesObj[kv[0]] = kv[1];
        });

        params.routes = routesObj;
    }
}


/*
 * Parses params in argv for key=val parameters, and returns them as a hash.
 */
function getKeyValParams(opts, idx) {
    var params = {};
    var errs = [];
    if (!idx) {
        idx = 0;
    }

    for (var i = idx; i < opts.argv.remain.length; i++) {
        var split = opts.argv.remain[i].split('=');
        if (split.length < 2) {
            errs.push(opts.argv.remain[i]);
            continue;
        }
        var key = split.shift();
        params[key] = split.join('=');
    }

    if (DEBUG) {
        console.error('command-line params: ' + json(params));
    }
    if (errs.length != 0) {
        exit('Invalid parameter%s: %s',
                (errs.length == 1 ? '' : 's'), errs.join(', '));
    }

    return params;
}


/*
 * Prints out the usage statement
 */
function usage() {
    console.log('Usage: ' + path.basename(process.argv[1]).replace('.js', '') +
            ' <command> [options]');
    console.log('');
    console.log('Commands:');
    console.log('');
    console.log('network-list [filter-param=value ...]');
    console.log('network-get <uuid>');
    console.log('network-create [param=value ...]');
    console.log('network-update <uuid> update_field=value ' +
            '[update_field2=value ...]');
    console.log('network-delete <uuid>');
    console.log('');
    console.log('nic-get <MAC address>');
    console.log('nic-create <MAC address> [field=value ...]');
    console.log('nic-provision <Logical Network UUID> [field=value ...]');
    console.log('nic-update <MAC address> update_field=value ' +
            '[update_field2=value ...]');
    console.log('nic-delete <MAC address>');
    console.log('nic-list [filter_field=value ...]');
    console.log('nics <UUID of owner>');
    console.log('');
    console.log('ip-list <Logical Network UUID>');
    console.log('ip-get <Logical Network UUID> <IP address>');
    console.log('ip-update <Logical Network UUID> <IP address> ' +
            'update_field=value [update_field2=value ...]');
    console.log('');
    console.log('nictag-list [filter-param=value ...]');
    console.log('nictag-get <UUID>');
    console.log('nictag-create <name> [field=value ...]');
    console.log('nictag-update <UUID> [field=value ...]');
    console.log('nictag-delete <UUID>');
    console.log('');
    console.log('networkpool-list [filter-param=value ...]');
    console.log('networkpool-get <UUID>');
    console.log('networkpool-create <name> [field=value ...]');
    console.log('networkpool-update <UUID> [field=value ...]');
    console.log('networkpool-delete <UUID>');
    console.log('');
    console.log('ping');
    console.log('log');
    console.log('lastlog');
    console.log('tail');
}


/*
 * Exits with a message.
 */
function exit() {
    console.error.apply(null, Array.prototype.slice.apply(arguments));
    process.exit(1);
}



// --- Nic endpoints



/*
 * Gets a nic from NAPI
 */
function getNic(napi, opts) {
    var macAddr = opts.argv.remain[1];
    if (!macAddr) {
        exit('Error: must supply MAC address!');
    }

    napi.getNic(macAddr, standardHandler);
}


/*
 * Deletes a nic from NAPI
 */
function deleteNic(napi, opts) {
    var macAddr = opts.argv.remain[1];
    if (!macAddr) {
        exit('Error: must supply MAC address!');
    }

    napi.deleteNic(macAddr, standardHandler);
}


/*
 * Lists all of the nics
 */
function listNics(napi, opts) {
    var params = getKeyValParams(opts, 1);
    napi.listNics(params, standardHandler);
}


/*
 * Lists all of the nics for a given owner
 */
function getNics(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }
    napi.getNics(uuid, standardHandler);
}


/*
 * Updates a nic
 */
function updateNic(napi, opts) {
    var macAddr = opts.argv.remain[1];
    if (!macAddr) {
        exit('Error: must supply MAC address!');
    }
    var params = getKeyValParams(opts, 2);
    if (Object.keys(params).length === 0) {
        exit('Must specify parameters to update!');
    }
    napi.updateNic(macAddr, params, standardHandler);
}


/*
 * Provisions a new nic in NAPI, with an IP address on the logical
 * network provided
 */
function provisionNic(napi, opts) {
    var network = opts.argv.remain[1];
    if (!network) {
        exit('Error: must supply logical network!');
    }
    var params = getKeyValParams(opts, 2);
    napi.provisionNic(network, params, standardHandler);
}


/*
 * Creates a new nic
 */
function createNic(napi, opts) {
    var macAddr = opts.argv.remain[1];
    if (!macAddr) {
        exit('Error: must supply MAC address!');
    }
    var params = getKeyValParams(opts, 2);
    napi.createNic(macAddr, params, standardHandler);
}



// --- Network endpoints



/*
 * Lists all of the networks
 */
function listNetworks(napi, opts) {
    var params = getKeyValParams(opts, 1);
    napi.listNetworks(params, standardHandler);
}

/*
 * Gets a network from NAPI
 */
function getNetwork(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID');
    }

    napi.getNetwork(uuid, standardHandler);
}

/*
 * Creates a new network
 */
function createNetwork(napi, opts) {
    var params = getKeyValParams(opts, 1);
    formatNetworkParams(params);
    napi.createNetwork(params, standardHandler);
}


/*
 * Updates a network
 */
function updateNetwork(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID');
    }

    var params = getKeyValParams(opts, 2);
    if (Object.keys(params).length === 0) {
        exit('Must specify parameters to update!');
    }

    formatNetworkParams(params);
    napi.updateNetwork(uuid, params, standardHandler);
}


/*
 * Deletes a network
 */
function deleteNetwork(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }
    var params = getKeyValParams(opts, 2);
    if (DEBUG) {
        console.log('params: %j', params);
    }
    napi.deleteNetwork(uuid, params, standardHandler);
}

/*
 * Lists the IPs for a network
 */
function listIPs(napi, opts) {
    var network = opts.argv.remain[1];
    if (!network) {
        exit('Error: must supply logical network!');
    }
    var params = getKeyValParams(opts, 2);
    napi.listIPs(network, params, standardHandler);
}


/*
 * Gets an IP in a network
 */
function getIP(napi, opts) {
    var network = opts.argv.remain[1];
    if (!network) {
        exit('Error: must supply logical network!');
    }
    var ipAddr = opts.argv.remain[2];
    if (!ipAddr) {
        exit('Error: must supply IP address!');
    }
    var params = getKeyValParams(opts, 3);
    napi.getIP(network, ipAddr, params, standardHandler);
}


/*
 * Updates an IP in a network
 */
function updateIP(napi, opts) {
    var network = opts.argv.remain[1];
    if (!network) {
        exit('Error: must supply logical network!');
    }
    var ipAddr = opts.argv.remain[2];
    if (!ipAddr) {
        exit('Error: must supply IP address!');
    }
    var params = getKeyValParams(opts, 3);
    if (Object.keys(params).length === 0) {
        exit('Must specify parameters to update!');
    }
    napi.updateIP(network, ipAddr, params, standardHandler);
}



// --- Nic Tag endpoints



/*
 * Lists all of the nic tags
 */
function listNicTags(napi, opts) {
    var params = getKeyValParams(opts, 1);
    napi.listNicTags(params, standardHandler);
}


/*
 * Creates a new nic tag
 */
function createNicTag(napi, opts) {
    var name = opts.argv.remain[1];
    if (!name) {
        exit('Error: must supply name!');
    }
    var params = getKeyValParams(opts, 2);
    napi.createNicTag(name, params, standardHandler);
}


/*
 * Gets a nic tag from NAPI
 */
function getNicTag(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }

    napi.getNicTag(uuid, standardHandler);
}


/*
 * Updates a nic tag
 */
function updateNicTag(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }
    var params = getKeyValParams(opts, 2);
    if (Object.keys(params).length === 0) {
        exit('Must specify parameters to update!');
    }
    napi.updateNicTag(uuid, params, standardHandler);
}


/*
 * Deletes a nic tag from NAPI
 */
function deleteNicTag(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }

    napi.deleteNicTag(uuid, standardHandler);
}



// --- Network Pool endpoints



/*
 * Lists all of the network pools
 */
function listNetworkPools(napi, opts) {
    var params = getKeyValParams(opts, 1);
    napi.listNetworkPools(params, standardHandler);
}


/*
 * Creates a new network pool
 */
function createNetworkPool(napi, opts) {
    var name = opts.argv.remain[1];
    if (!name) {
        exit('Error: must supply name!');
    }
    var params = getKeyValParams(opts, 2);
    napi.createNetworkPool(name, params, standardHandler);
}


/*
 * Gets a network pool from NAPI
 */
function getNetworkPool(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }

    napi.getNetworkPool(uuid, standardHandler);
}


/*
 * Updates a network pool
 */
function updateNetworkPool(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }
    var params = getKeyValParams(opts, 2);
    if (Object.keys(params).length === 0) {
        exit('Must specify parameters to update!');
    }
    napi.updateNetworkPool(uuid, params, standardHandler);
}


/*
 * Deletes a network pool from NAPI
 */
function deleteNetworkPool(napi, opts) {
    var uuid = opts.argv.remain[1];
    if (!uuid) {
        exit('Error: must supply UUID!');
    }

    napi.deleteNetworkPool(uuid, standardHandler);
}



main();
