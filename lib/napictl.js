/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Tool for administering networks in SmartDataCenter via NAPI, the
 * Networking API
 */

/* eslint-disable no-unused-vars */

'use strict';

var assert = require('assert-plus');
var cmdln = require('cmdln');
var fmt = require('util').format;
var mod_config = require('./config');
var NAPI = require('sdc-clients').NAPI;
var path = require('path');
var util = require('util');
var util_common = require('./util/common');
var VError = require('verror').VError;



// --- Globals



var DESC = {
    kv: 'key=val key2=val ...',
    mtu: 'MTU',
    net: 'Network UUID',
    owner: 'Owner UUID',
    vlan: 'VLAN ID'
};
var OPTS = [
    { names: ['debug', 'd'], type: 'bool', default: false,
        help: 'Output debugging information.' },
    { names: ['help', 'h'], type: 'bool',
        help: 'Print help and exit.' },
    { names: ['host' ], type: 'string',
        help: 'NAPI host.' },
    { names: ['json', 'j'], type: 'bool', default: false,
        help: 'Output JSON.' },
    { names: ['verbose', 'v'], type: 'bool', default: false,
        help: 'Verbose output.' }
];
var ROUTES_MSG = 'Invalid routes format: must be a comma-separated list of '
    + 'destination:gateway pairs\n';



// --- Utility functions



/**
 * Error class for missing CLI arguments
 */
function MissingArgumentError(arg) {
    this.message = 'missing ' + arg;
    Error.call(this, this.message);
}
util.inherits(MissingArgumentError, Error);


/**
 * Error class for CLI arguments passed in invalid form
 */
function InvalidArgumentError(arg, reason) {
    this.message = fmt('invalid %s: %s', arg, reason);
    Error.call(this, this.message);
}
util.inherits(InvalidArgumentError, Error);


/**
 * Output an invalid parameter error (with optional field element)
 */
function fieldErr(fErr, indent) {
    console.error('%s%s: %s%s', indent ? '  ' : '',
        fErr.code,
        fErr.hasOwnProperty('field') ? fErr.field + ': ' : '',
        fErr.message);
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
                throw new Error(ROUTES_MSG);
            }

            routesObj[kv[0]] = kv[1];
        });

        params.routes = routesObj;
    }

    if (params.hasOwnProperty('mtu')) {
        params.mtu = Number(params.mtu);
    }
}


/*
 * Nicely formats a JSON object
 */
function json(obj) {
    return JSON.stringify(obj, null, 2);
}


/**
 * Makes sure all of the required args are present, and throws an error
 * if they are not.
 */
function requiredArgs(args, names) {
    assert.ok(util.isArray(args), 'args');
    assert.arrayOfString(names, 'names');

    var found = [];
    var missing = [];
    for (var i in names) {
        if (args[i] === undefined) {
            missing.push(names[i]);
        } else {
            found.push(args[i]);
        }
    }

    if (missing.length !== 0) {
        throw new MissingArgumentError(missing.join(', '));
    }

    return found;
}



// --- NapiCli object



/**
 * NapiCli constructor
 */
function NapiCli() {
    cmdln.Cmdln.call(this, {
        name: 'sdc-netadm',
        desc: 'Administer SDC networking',
        helpOpts: {
            minHelpCol: 27
        },
        options: OPTS
    });
}

util.inherits(NapiCli, cmdln.Cmdln);


/**
 * Initializes properties in the NapiCli object
 */
NapiCli.prototype.init = function (opts, args, callback) {
    if (opts.help || args.length === 0) {
        // Don't bother loading (or failing to load) the config, since we're
        // just printing the help mesage
        return callback();
    }

    var host = 'localhost';
    var port = process.env.NAPI_PORT || 80;

    if (opts.host) {
        host = opts.host;
    } else if (process.env.NAPI_HOST) {
        host = process.env.NAPI_HOST;
    } else {
        port = mod_config.load(
            path.normalize(__dirname + '/../config.json'));
    }

    this.debug = opts.debug;
    this.napi = new NAPI({
        agent: false,
        url: fmt('http://%s:%d', host, port)
    });
    this.json = opts.json;
    this.verbose = opts.verbose;

    return callback();
};


/*
 * Parses params in argv for key=val parameters, and returns them as a hash.
 */
NapiCli.prototype.getKeyValArgs = function (args, idx) {
    var params = {};
    var errs = [];
    if (!idx) {
        idx = 0;
    }

    if (this.debug) {
        console.error('key-val args (idx=%d): %s', idx, json(args));
    }

    for (var i = idx; i < args.length; i++) {
        var split = args[i].split('=');
        if (split.length < 2) {
            errs.push(args[i]);
            continue;
        }
        var key = split.shift();
        params[key] = split.join('=');
    }

    if (this.debug) {
        console.error('command-line params: ' + json(params));
    }

    if (errs.length !== 0) {
        throw new VError('Invalid key / value parameter%s: %s',
                (errs.length === 1 ? '' : 's'), errs.join(', '));
    }

    return params;
};


/**
 * Call a NAPI endpoint and handle the results
 */
NapiCli.prototype.napiAction = function (opts, callback) {
    var self = this;
    var fnArgs = opts.fnArgs || [];

    function outputRes(err, obj, req, res) {
        if (err) {
            if (self.json) {
                return console.error(json(err));
            }

            if (err.hasOwnProperty('body') &&
                err.body.hasOwnProperty('errors')) {
                err.body.errors.forEach(function (e) {
                    fieldErr(e);
                });
            }

            return callback(err);
        }

        if (self.verbose) {
            if (obj.hasOwnProperty('statusCode')) {
                obj.statusCode = res.statusCode;
            }

            if (obj.hasOwnProperty('code')) {
                obj.code = res.code;
            }
        }

        console.log(json(obj));
        return callback();
    }

    if (opts.args && opts.hasOwnProperty('kv')) {
        try {
            var kv = this.getKeyValArgs(opts.args, opts.kv);
            if (opts.kvRequired && Object.keys(kv).length === 0) {
                throw new Error('must specify key / value parameters');
            }

            // Post-process the key/val args if necessary
            if (opts.kvPostFn) {
                opts.kvPostFn(kv);
            }

            fnArgs.push(kv);

        } catch (err) {
            return callback(err);
        }
    }

    fnArgs.push(outputRes);
    this.napi[opts.fn].apply(this.napi, fnArgs);
};



// --- Nic endpoints


/**
 * Get a nic
 */
NapiCli.prototype['do_get-nic'] = function (subcmd, opts, args, callback) {
    var macAddr = args[0];
    if (!macAddr) {
        return callback(new MissingArgumentError('MAC address'));
    }

    this.napiAction({ fn: 'getNic', fnArgs: [ macAddr ] }, callback);
};

NapiCli.prototype['do_get-nic'].help = 'Get a nic';


/**
 * Delete a nic
 */
NapiCli.prototype['do_delete-nic'] = function (subcmd, opts, args, callback) {
    var macAddr = args[0];
    if (!macAddr) {
        return callback(new MissingArgumentError('MAC address'));
    }

    this.napiAction({ fn: 'deleteNic', fnArgs: [ macAddr ] }, callback);
};

NapiCli.prototype['do_delete-nic'].help = 'Delete a nic';


/**
 * Lists nics
 */
NapiCli.prototype['do_list-nics'] = function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'listNics', args: args, kv: 0 }, callback);
};

NapiCli.prototype['do_list-nics'].help = 'List nics';


/**
 * Lists nics for a given owner
 */
NapiCli.prototype['do_nics'] = function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID'));
    }

    this.napiAction({ fn: 'getNics', fnArgs: [ uuid ] }, callback);
};

NapiCli.prototype['do_nics'].help = 'List nics that belong to a UUID';


/**
 * Update a nic
 */
NapiCli.prototype['do_update-nic'] = function (subcmd, opts, args, callback) {
    var macAddr = args[0];
    if (!macAddr) {
        return callback(new MissingArgumentError('MAC address'));
    }

    this.napiAction({
        fn: 'updateNic',
        fnArgs: [ macAddr ],
        args: args,
        kv: 1,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_update-nic'].help = 'Update a nic';


/**
 * Provisions a new nic in NAPI, with an IP address on the logical
 * network provided
 */
NapiCli.prototype['do_provision-nic'] =
    function (subcmd, opts, args, callback) {
    var network = args[0];
    if (!network) {
        return callback(new MissingArgumentError('logical network'));
    }

    this.napiAction({
        fn: 'provisionNic',
        fnArgs: [ network ],
        args: args,
        kv: 1,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_provision-nic'].help =
    'Provision a nic on a logical network';


/**
 * Create a nic
 */
NapiCli.prototype['do_create-nic'] = function (subcmd, opts, args, callback) {
    var macAddr = args[0];
    if (!macAddr) {
        return callback(new MissingArgumentError('MAC address'));
    }

    this.napiAction({
        fn: 'createNic',
        fnArgs: [ macAddr ],
        args: args,
        kv: 1,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_create-nic'].help = 'Create a nic';



// --- Network endpoints



/**
 * Lists networks
 */
NapiCli.prototype['do_list-networks'] =
    function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'listNetworks', args: args, kv: 0 }, callback);
};

NapiCli.prototype['do_list-networks'].help = fmt('[%s]', DESC.kv);


/**
 * Get a network
 */
NapiCli.prototype['do_get-network'] = function (subcmd, opts, args, callback) {
    try {
        var valid = requiredArgs(args, [ DESC.net ]);
    } catch (validErr) {
        return callback(validErr);
    }

    this.napiAction({ fn: 'getNetwork', fnArgs: valid }, callback);
};

NapiCli.prototype['do_get-network'].help = fmt('<%s>', DESC.net);


/**
 * Create a network
 */
NapiCli.prototype['do_create-network'] =
    function (subcmd, opts, args, callback) {
    this.napiAction({
        fn: 'createNetwork',
        args: args,
        kv: 0,
        kvRequired: true,
        kvPostFn: formatNetworkParams
    }, callback);
};

NapiCli.prototype['do_create-network'].help =
    fmt('<%s> [%s]', DESC.net, DESC.kv);


/**
 * Update a network
 */
NapiCli.prototype['do_update-network'] =
        function (subcmd, opts, args, callback) {
    try {
        var valid = requiredArgs(args, [ DESC.net ]);
    } catch (validErr) {
        return callback(validErr);
    }

    this.napiAction({
        fn: 'updateNetwork',
        fnArgs: valid,
        args: args,
        kv: 1,
        kvRequired: true,
        kvPostFn: formatNetworkParams
    }, callback);
};

NapiCli.prototype['do_update-network'].help =
    fmt('<%s> [%s]', DESC.net, DESC.kv);


/**
 * Delete a network
 */
NapiCli.prototype['do_delete-network'] =
    function (subcmd, opts, args, callback) {
    try {
        var valid = requiredArgs(args, [ DESC.net ]);
    } catch (validErr) {
        return callback(validErr);
    }

    this.napiAction({ fn: 'deleteNetwork', fnArgs: valid }, callback);
};

NapiCli.prototype['do_delete-network'].help = fmt('<%s>', DESC.net);



// --- IP endpoints



/**
 * List IPs on a network
 */
NapiCli.prototype['do_list-ips'] = function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('network UUID'));
    }

    this.napiAction({
        fn: 'listIPs',
        fnArgs: [ uuid ],
        args: args,
        kv: 1
    }, callback);
};

NapiCli.prototype['do_list-ips'].help = 'List IPs on a network';


/**
 * Get an IP in a network
 */
NapiCli.prototype['do_get-ip'] = function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('network UUID'));
    }

    var ip = args[1];
    if (!ip) {
        return callback(new MissingArgumentError('IP address'));
    }

    this.napiAction({
        fn: 'getIP',
        fnArgs: [ uuid, ip ],
        args: args,
        kv: 2
    }, callback);
};

NapiCli.prototype['do_get-ip'].help = 'Get an IP on a network';


/**
 * Search for IPs
 */
NapiCli.prototype['do_search-ips'] = function (subcmd, opts, args, callback) {
    var ip = args[0];
    if (!ip) {
        return callback(new MissingArgumentError('IP address'));
    }

    this.napiAction({
        fn: 'searchIPs',
        fnArgs: [ ip ]
    }, callback);
};

NapiCli.prototype['do_search-ips'].help = 'Search for an IP';


/**
 * Update an IP
 */
NapiCli.prototype['do_update-ip'] =
    function (subcmd, opts, args, callback) {
    var network = args[0];
    if (!network) {
        return callback(new MissingArgumentError('network UUID'));
    }

    var ip = args[1];
    if (!ip) {
        return callback(new MissingArgumentError('IP address'));
    }

    this.napiAction({
        fn: 'updateIP',
        fnArgs: [ network, ip ],
        args: args,
        kv: 2,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_update-ip'].help = 'Update an IP';



// --- Nic Tag endpoints



/**
 * List nic tags
 */
NapiCli.prototype['do_list-nictags'] = function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'listNicTags', args: args, kv: 0 }, callback);
};

NapiCli.prototype['do_list-nictags'].help = 'List nic tags';


/**
 * Create a nic tag
 */
NapiCli.prototype['do_create-nictag'] =
    function (subcmd, opts, args, callback) {
    var name = args[0];
    if (!name) {
        return callback(new MissingArgumentError('name'));
    }

    this.napiAction({
        fn: 'createNicTag',
        fnArgs: [ name ],
        args: args,
        kv: 1,
        kvPostFn: function _convertVLAN(kv) {
            if (kv && kv.hasOwnProperty('mtu')) {
                kv.mtu = Number(kv.mtu);
            }

            if (!kv || isNaN(kv.mtu)) {
                throw new InvalidArgumentError(DESC.mtu, 'must be a number');
            }
        }
    }, callback);
};

NapiCli.prototype['do_create-nictag'].help = 'Create a nic tag';


/**
 * Get a nic tag
 */
NapiCli.prototype['do_get-nictag'] = function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID or name'));
    }

    this.napiAction({ fn: 'getNicTag', fnArgs: [ uuid ] }, callback);
};

NapiCli.prototype['do_get-nictag'].help = 'Get a nic tag';


/**
 * Update a nic tag
 */
NapiCli.prototype['do_update-nictag'] =
    function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID or name'));
    }

    this.napiAction({
        fn: 'updateNicTag',
        fnArgs: [ uuid ],
        args: args,
        kv: 1,
        kvRequired: true,
        kvPostFn: function _convertVLAN(kv) {
            if (kv && kv.hasOwnProperty('mtu')) {
                kv.mtu = Number(kv.mtu);
            }

            if (!kv || isNaN(kv.mtu)) {
                throw new InvalidArgumentError(DESC.mtu, 'must be a number');
            }
        }
    }, callback);
};

NapiCli.prototype['do_update-nictag'].help = 'Update a nic tag';


/**
 * Delete a nic tag
 */
NapiCli.prototype['do_delete-nictag'] =
    function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID or name'));
    }

    this.napiAction({ fn: 'deleteNicTag', fnArgs: [ uuid ] }, callback);
};

NapiCli.prototype['do_delete-nictag'].help = 'Delete a nic tag';



// --- Network Pool endpoints



/**
 * Lists network pools
 */
NapiCli.prototype['do_list-networkpools'] =
    function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'listNetworkPools', args: args, kv: 0 }, callback);
};

NapiCli.prototype['do_list-networkpools'].help = 'List network pools';


/**
 * Create a network pool
 */
NapiCli.prototype['do_create-networkpool'] =
    function (subcmd, opts, args, callback) {
    var name = args[0];
    if (!name) {
        return callback(new MissingArgumentError('name'));
    }

    this.napiAction({
        fn: 'createNetworkPool',
        fnArgs: [ name ],
        args: args,
        kv: 1
    }, callback);
};

NapiCli.prototype['do_create-networkpool'].help = 'Create a network pool';


/**
 * Get a network pool
 */
NapiCli.prototype['do_get-networkpool'] =
    function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID'));
    }

    this.napiAction({ fn: 'getNetworkPool', fnArgs: [ uuid ] }, callback);
};

NapiCli.prototype['do_get-networkpool'].help = 'Get a network pool';


/**
 * Update a network pool
 */
NapiCli.prototype['do_update-networkpool'] =
    function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID'));
    }

    this.napiAction({
        fn: 'updateNetworkPool',
        fnArgs: [ uuid ],
        args: args,
        kv: 1,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_update-networkpool'].help = 'Update a network pool';


/**
 * Delete a network pool
 */
NapiCli.prototype['do_delete-networkpool'] =
    function (subcmd, opts, args, callback) {
    var uuid = args[0];
    if (!uuid) {
        return callback(new MissingArgumentError('UUID or name'));
    }

    this.napiAction({ fn: 'deleteNetworkPool', fnArgs: [ uuid ] }, callback);
};

NapiCli.prototype['do_delete-networkpool'].help = 'Delete a network pool';



// --- Aggregation endpoints



/**
 * Lists aggregations
 */
NapiCli.prototype['do_list-aggrs'] = function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'listAggrs', args: args, kv: 0 }, callback);
};

NapiCli.prototype['do_list-aggrs'].help = 'List Aggregations';


/**
 * Get an aggregation
 */
NapiCli.prototype['do_get-aggr'] = function (subcmd, opts, args, callback) {
    var id = args[0];
    if (!id) {
        return callback(new MissingArgumentError('ID'));
    }

    this.napiAction({ fn: 'getAggr', fnArgs: [ id ] }, callback);
};

NapiCli.prototype['do_get-aggr'].help = 'Get an aggregation';


/**
 * Create an aggregation
 */
NapiCli.prototype['do_create-aggr'] =
    function (subcmd, opts, args, callback) {
    this.napiAction({
        fn: 'createAggr',
        args: args,
        kv: 0,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_create-aggr'].help = 'Create an aggregation';


/**
 * Update an aggregation
 */
NapiCli.prototype['do_update-aggr'] = function (subcmd, opts, args, callback) {
    var id = args[0];
    if (!id) {
        return callback(new MissingArgumentError('ID'));
    }

    this.napiAction({
        fn: 'updateAggr',
        fnArgs: [ id ],
        args: args,
        kv: 1,
        kvRequired: true
    }, callback);
};

NapiCli.prototype['do_update-aggr'].help = 'Update an aggregation';


/**
 * Delete a aggr
 */
NapiCli.prototype['do_delete-aggr'] =
    function (subcmd, opts, args, callback) {
    var id = args[0];
    if (!id) {
        return callback(new MissingArgumentError('ID'));
    }

    this.napiAction({
        fn: 'deleteAggr',
        fnArgs: [ id ],
        args: args,
        kv: 1
    }, callback);
};

NapiCli.prototype['do_delete-aggr'].help = 'Delete an aggregation';



// --- Fabric VLAN endpoints



/**
 * Create a Fabric VLAN
 */
NapiCli.prototype['do_create-fabric-vlan'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner ]);
    } catch (validErr) {
        return callback(validErr);
    }

    this.napiAction({
        args: args,
        fn: 'createFabricVLAN',
        fnArgs: valid,
        kv: 1,
        kvPostFn: function _convertVLAN(kv) {
            if (kv && kv.hasOwnProperty('vlan_id')) {
                kv.vlan_id = Number(kv.vlan_id);
            }

            if (!kv || isNaN(kv.vlan_id)) {
                throw new InvalidArgumentError(DESC.vlan, 'must be a number');
            }
        }
    }, callback);
};

NapiCli.prototype['do_create-fabric-vlan'].help =
    fmt('<%s> [vlan_id=<number> %s]', DESC.owner, DESC.kv);


/**
 * Delete a Fabric VLAN
 */
NapiCli.prototype['do_delete-fabric-vlan'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }
    valid.push({});

    this.napiAction({ fn: 'deleteFabricVLAN', fnArgs: valid },
        callback);
};

NapiCli.prototype['do_delete-fabric-vlan'].help =
    fmt('<%s> <%s>', DESC.owner, DESC.vlan);


/**
 * Get a Fabric VLAN
 */
NapiCli.prototype['do_get-fabric-vlan'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }
    valid.push({});

    this.napiAction({ fn: 'getFabricVLAN', fnArgs: valid },
        callback);
};

NapiCli.prototype['do_get-fabric-vlan'].help =
    fmt('<%s> <%s>', DESC.owner, DESC.vlan);


/**
 * List Fabric VLANs
 */
NapiCli.prototype['do_list-fabric-vlans'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner ]);
    } catch (validErr) {
        return callback(validErr);
    }

    this.napiAction({
        args: args,
        fn: 'listFabricVLANs',
        fnArgs: valid,
        kv: 1
    }, callback);
};

NapiCli.prototype['do_list-fabric-vlans'].help =
    fmt('<%s> [%s]', DESC.owner, DESC.kv);


/**
 * List Fabric VLANs
 */
NapiCli.prototype['do_update-fabric-vlan'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }

    this.napiAction({
        args: args,
        fn: 'updateFabricVLAN',
        fnArgs: valid,
        kv: 2
    }, callback);
};

NapiCli.prototype['do_update-fabric-vlan'].help =
    fmt('<%s> <%s> [%s]', DESC.owner, DESC.vlan, DESC.kv);



// --- Fabric Network endpoints



/**
 * Create a Fabric Network
 */
NapiCli.prototype['do_create-fabric-network'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }

    this.napiAction({
        args: args,
        fn: 'createFabricNetwork',
        fnArgs: valid,
        kv: 2,
        kvPostFn: formatNetworkParams
    }, callback);
};

NapiCli.prototype['do_create-fabric-network'].help =
    fmt('<%s> <%s> [%s]', DESC.owner, DESC.vlan, DESC.kv);


/**
 * Delete a Fabric Network
 */
NapiCli.prototype['do_delete-fabric-network'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan, DESC.net ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }
    valid.push({});

    this.napiAction({ fn: 'deleteFabricNetwork', fnArgs: valid },
        callback);
};

NapiCli.prototype['do_delete-fabric-network'].help =
    fmt('<%s> <%s> <%s>', DESC.owner, DESC.vlan, DESC.network);


/**
 * Get a Fabric Network
 */
NapiCli.prototype['do_get-fabric-network'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan, DESC.net ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }
    valid.push({});

    this.napiAction({ fn: 'getFabricNetwork', fnArgs: valid },
        callback);
};

NapiCli.prototype['do_get-fabric-network'].help =
    fmt('<%s> <%s> <%s>', DESC.owner, DESC.vlan, DESC.network);


/**
 * List Fabric Networks
 */
NapiCli.prototype['do_list-fabric-networks'] =
        function (subcmd, opts, args, callback) {

    try {
        var valid = requiredArgs(args, [ DESC.owner, DESC.vlan ]);
    } catch (validErr) {
        return callback(validErr);
    }

    valid[1] = Number(valid[1]);

    if (isNaN(valid[1])) {
        return callback(new InvalidArgumentError(DESC.vlan,
            'must be a number'));
    }

    this.napiAction({
        args: args,
        fn: 'listFabricNetworks',
        fnArgs: valid,
        kv: 2
    }, callback);
};

NapiCli.prototype['do_list-fabric-networks'].help =
    fmt('<%s> <%s> [%s]', DESC.owner, DESC.vlan, DESC.kv);



// --- Misc endpoints



/**
 * Ping NAPI
 */
NapiCli.prototype['do_ping'] = function (subcmd, opts, args, callback) {
    this.napiAction({ fn: 'ping' }, callback);
};

NapiCli.prototype['do_ping'].help = 'Ping NAPI';



// --- main



cmdln.main(NapiCli);
