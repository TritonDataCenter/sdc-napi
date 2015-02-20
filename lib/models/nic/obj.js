/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * nic model object
 */

var assert = require('assert-plus');
var common = require('./common');
var mod_moray = require('../../apis/moray');
var mod_net = require('../network');
var mod_ip = require('../ip');
var util = require('util');
var util_common = require('../../util/common');
var util_ip = require('../../util/ip');
var util_mac = require('../../util/mac');
var vasync = require('vasync');



// --- Globals



// Boolean nic parameters: if it's true, display it when serializing.  If
// it's false, don't serialize it.
var BOOL_PARAMS = ['allow_dhcp_spoofing', 'allow_ip_spoofing',
    'allow_mac_spoofing', 'allow_restricted_traffic',
    'allow_unfiltered_promisc'];

var OPTIONAL_PARAMS = [
    'model',
    'nic_tag'
];



// --- Internal



/**
 * Adds an IP and network object to a nic object (if required)
 */
function addIPtoNic(app, log, res, callback) {
    if (!res.params.ip || !res.params.network_uuid) {
        return callback(null, res);
    }

    var network, ip;

    return vasync.parallel({
        funcs: [
            function _addIP_getNetwork(cb) {
                var netGetOpts = {
                    app: app,
                    log: log,
                    params: { uuid: res.params.network_uuid }
                };

                mod_net.get(netGetOpts, function (e, r) {
                    if (r) {
                        network = r;
                    }
                    return cb(e);
                });
            },
            function _addIP_getIP(cb) {
                var getOpts = {
                    app: app,
                    log: log,
                    params: {
                        ip: res.params.ip,
                        network_uuid: res.params.network_uuid
                    }
                };

                mod_ip.get(getOpts, function (e, r) {
                    if (r) {
                        ip = r;
                    }
                    return cb(e);
                });
            }
        ]
    }, function (err2) {
        if (err2) {
            log.error(err2, 'addIPtoNic: Missing IP or network');
            return callback(null, res);
        }

        if (!network || !ip) {
            log.error({ network: network, ip: ip },
                'addIPtoNic: Missing IP or network');
            return callback(null, res);
        }

        if (log.trace()) {
            log.trace({
                ip: ip.serialize(),
                network: network.serialize()
            }, 'added IP and network');
        }

        res.ip = ip;
        res.network = network;
        return callback(null, res);
    });
}



// --- Nic object



/**
 * Nic model constructor
 */
function Nic(params) {
    assert.object(params, 'params');
    assert.ok(params.mac, 'mac (number / string) is required');
    assert.string(params.owner_uuid, 'owner_uuid');
    assert.string(params.belongs_to_uuid, 'belongs_to_uuid');
    assert.string(params.belongs_to_type, 'belongs_to_type');
    assert.optionalString(params.model, 'model');
    assert.optionalString(params.nic_tag, 'nic_tag');
    assert.optionalString(params.state, 'state');

    params.state = params.state || 'running';

    // Allow mac to be passed in as a number or address, but the internal
    // representation is always a number
    var mac = params.mac;
    if (isNaN(mac)) {
        mac = util_mac.macAddressToNumber(params.mac);
    }
    assert.ok(mac, util.format('invalid MAC address "%s"', params.mac));
    params.mac = mac;

    // Allow for a comma-separated list, like on the commandline
    if (params.hasOwnProperty('nic_tags_provided')) {
        params.nic_tags_provided =
            util_common.arrayify(params.nic_tags_provided);
        assert.optionalArrayOfString(params.nic_tags_provided,
            'nic_tags_provided');
        if (params.nic_tags_provided.length === 0) {
            delete params.nic_tags_provided;
        }
    }

    this.params = params;

    if (params.hasOwnProperty('etag')) {
        this.etag = params.etag;
    } else {
        this.etag = null;
    }

    if (params.hasOwnProperty('primary') &&
        typeof (params.primary) !== 'boolean') {
        this.params.primary = params.primary === 'true' ? true : false;
    }

    this.__defineGetter__('mac', function () { return this.params.mac; });
    this.__defineSetter__('mac', function (val) {
        this.params.mac = val;
    });
}


/**
 * Returns an object suitable for passing to a moray batch
 */
Nic.prototype.batch = function nicBatch() {
    return {
        bucket: common.BUCKET.name,
        key: this.mac.toString(),
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag
        }
    };
};


/**
 * Returns the serialized form of the nic
 */
Nic.prototype.serialize = function nicSerialize() {
    var self = this;
    var macAddr = util_mac.ntoa(this.params.mac);
    var serialized = {
        belongs_to_type: this.params.belongs_to_type,
        belongs_to_uuid: this.params.belongs_to_uuid,
        mac: macAddr,
        owner_uuid: this.params.owner_uuid,
        primary: this.params.primary ? true : false,
        state: this.params.state
    };

    if (this.ip) {
        var ipSer = this.ip.serialize();
        serialized.ip = ipSer.ip;
    }

    if (this.network) {
        var netSer = this.network.serialize();
        var netParams = ['netmask', 'gateway', 'vlan_id', 'nic_tag',
            'resolvers', 'routes'];
        for (var p in netParams) {
            if (netSer.hasOwnProperty(netParams[p])) {
                serialized[netParams[p]] = netSer[netParams[p]];
            }
        }
        serialized.network_uuid = netSer.uuid;
    }

    // Allow the nic to override its network's nic tag
    OPTIONAL_PARAMS.forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            serialized[param] = self.params[param];
        }
    });

    if (this.params.hasOwnProperty('nic_tags_provided')) {
        serialized.nic_tags_provided = this.params.nic_tags_provided;
    }

    BOOL_PARAMS.forEach(function (param) {
        if (self.params[param]) {
            serialized[param] = true;
        }
    });

    return serialized;
};


/**
 * Returns the raw form of the nic suitable for storing in moray
 */
Nic.prototype.raw = function nicRaw() {
    var self = this;
    var raw = {
        mac: this.params.mac,
        owner_uuid: this.params.owner_uuid,
        belongs_to_uuid: this.params.belongs_to_uuid,
        belongs_to_type: this.params.belongs_to_type,
        primary_flag: this.params.primary ? true : false,
        state: this.params.state
    };

    if (this.ip && this.network) {
        // XXX: write both address and number here (if the bucket supports it)
        // raw.ip = this.ip.address.toString();
        raw.ip = util_ip.aton(this.ip.address.toString());
        raw.network_uuid = this.network.uuid;
    }

    BOOL_PARAMS.forEach(function (param) {
        if (self.params[param]) {
            raw[param] = true;
        }
    });

    OPTIONAL_PARAMS.forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            raw[param] = self.params[param];
            raw.free = false;
        }
    });

    // Store nic_tags_provided as a string - this allows it to be indexed
    // properly in moray, which in turn allows searching on all of the values
    if (this.params.hasOwnProperty('nic_tags_provided')) {
        raw.nic_tags_provided =
            mod_moray.arrayToVal(this.params.nic_tags_provided);
    }

    return raw;
};



// --- Exports



/**
 * Creates a nic from the raw moray data
 */
function createFromRaw(opts, rec, callback) {
    opts.log.debug(rec, 'createFromRaw: creating nic');
    var params = rec.value;

    mod_moray.valToArray(params, 'nic_tags_provided');
    if (params.hasOwnProperty('primary_flag')) {
        params.primary = params.primary_flag;
    }

    var newNic;
    try {
        newNic = new Nic(params);
    } catch (err) {
        return callback(err);
    }

    newNic.etag = rec._etag;

    return addIPtoNic(opts.app, opts.log, newNic, callback);
}



module.exports = {
    createFromRaw: createFromRaw,
    Nic: Nic
};
