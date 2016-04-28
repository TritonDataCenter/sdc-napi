/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * nic model object
 */

'use strict';

var assert = require('assert-plus');
var BUCKET = require('./bucket').BUCKET;
var constants = require('../../util/constants');
var errors = require('../../util/errors');
var fmt = require('util').format;
var mod_moray = require('../../apis/moray');
var mod_portolan_moray = require('portolan-moray');
var mod_net = require('../network');
var mod_ip = require('../ip');
var util_ip = require('../../util/ip');
var util_mac = require('../../util/mac');
var vasync = require('vasync');
var VError = require('verror').VError;



// --- Globals



// Boolean nic parameters: if it's true, display it when serializing.  If
// it's false, don't serialize it.
var BOOL_PARAMS = [
    'allow_dhcp_spoofing',
    'allow_ip_spoofing',
    'allow_mac_spoofing',
    'allow_restricted_traffic',
    'allow_unfiltered_promisc',
    'underlay'
];

// Read-only parameters from the network that will be serialized in the nic
// object.
var NET_PARAMS = [
    'fabric',
    'gateway',
    'gateway_provisioned',
    'internet_nat',
    'mtu',
    'netmask',
    'nic_tag',
    'resolvers',
    'routes',
    'vlan_id'
];

var OPTIONAL_PARAMS = [
    'cn_uuid',
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

    return vasync.pipeline({
        funcs: [
            function _addIP_getNetwork(_, cb) {
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
            function _addIP_getIP(_, cb) {
                var getOpts = {
                    app: app,
                    log: log,
                    params: {
                        ip: res.params.ip,
                        network: network,
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
        var missing = [];

        if (err2) {
            log.error(err2, 'addIPtoNic: Error getting IP or network');
            return callback(new errors.InternalError(err2));
        }

        if (!network) {
            missing.push('network ' + res.params.network_uuid);
        }

        if (!ip) {
            missing.push('IP ' + res.params.ip);
        }

        if (missing.length !== 0) {
            var missingErr = new VError('Error loading nic: %s not found',
                missing.join(' and '));
            log.error({ err: missingErr, network: network, ip: ip },
                'addIPtoNic: Missing IP or network');

            return callback(missingErr);
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

    params.state = params.state || constants.DEFAULT_NIC_STATE;

    // Allow mac to be passed in as a number or address, but the internal
    // representation is always a number
    var mac = params.mac;
    // XXX - isNaN() is not safe here '' coerces to 0, which we don't want.
    if (isNaN(mac)) {
        mac = util_mac.macAddressToNumber(params.mac);
    }
    assert.ok(mac, fmt('invalid MAC address "%s"', params.mac));
    params.mac = mac;

    if (params.hasOwnProperty('nic_tags_provided_arr')) {
        params.nic_tags_provided = params.nic_tags_provided_arr;
        if (params.nic_tags_provided.length === 0) {
            delete params.nic_tags_provided;
            delete params.nic_tags_provided_arr;
        }
    } else {
        mod_moray.valToArray(params, 'nic_tags_provided');
        if (params.nic_tags_provided && params.nic_tags_provided.length === 0) {
            delete params.nic_tags_provided;
        }
    }

    if (params.hasOwnProperty('primary_flag')) {
        params.primary = params.primary_flag;
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
}

Object.defineProperty(Nic.prototype, 'mac', {
    get: function () { return this.params.mac; },
    set: function (val) { this.params.mac = val; }
});


/**
 * Returns an object suitable for passing to a moray batch
 */
Nic.prototype.batch = function nicBatch(opts) {
    var batch = [
        {
            bucket: BUCKET.name,
            key: this.mac.toString(),
            operation: 'put',
            value: this.raw(),
            options: {
                etag: this.etag
            }
        }
    ];

    if (opts && opts.migration) {
        // If we're migrating, don't do any of the updates below - they
        // can end up modifying the content of the other nics in the batch
        // out from under them, which renders their etags invalid.  This in
        // turn causes the batch to fail.
        return batch;
    }

    if (this.params.primary) {
        batch.push({
            bucket: BUCKET.name,
            fields: {
                primary_flag: 'false'
            },
            filter: fmt('(&(belongs_to_uuid=%s)(!(mac=%d)))',
                this.params.belongs_to_uuid, this.mac),
            operation: 'update'
        });
    }

    if (this.isUnderlay()) {
        // This is an underlay vnic - add it to the portolan underlay table
        // so other CNs can communicate with it.
        batch.push(mod_portolan_moray.underlayMappingBatch({
            cn_uuid: this.params.belongs_to_uuid,
            ip: this.ip.v6address,
            port: constants.VXLAN_PORT
        }));
    }


    if (this.isFabric()) {
        // This is a fabric vnic - add it to the portolan overlay table
        // so other VMs on the fabric can communicate with it.
        // XXX - suspect spurious updates from net-agent PUTs
        batch.push(mod_portolan_moray.overlayMappingBatch({
            cn_uuid: this.params.cn_uuid,
            deleted: false,
            ip: this.ip.v6address,
            mac: this.mac,
            vnet_id: this.network.vnet_id
        }));

        // Poor factoring of the create/update code means that this
        // section is a no-op for updates of type 'update', which are instead
        // created in update#updateParams - specifically, opts.vnetCns will
        // be empty here in that case. This section does cover nic creation
        // and updates of type 'provision'.
        var _vl3batch = mod_portolan_moray.vl3CnEventBatch({
            vnetCns: opts.vnetCns,
            vnet_id: this.network.vnet_id,
            ip: this.ip.v6address,
            mac: this.mac,
            vlan_id: this.network.params.vlan_id
        });

        opts.log.debug({
            vnet_id: this.network.vnet_id,
            ip: this.ip.v6address,
            mac: this.mac,
            vlan: this.network.params.vlan_id,
            key: _vl3batch.uuid,
            batch: _vl3batch
        }, 'creating vl3 logs');

        batch = batch.concat(_vl3batch);
    }

    if (this.isFabricGateway()) {
        this.network.gateway_provisioned = true;
        batch.push(this.network.batch());
    }

    return batch;
};


/**
 * Returns a moray batch that deletes this nic from all moray tables
 */
Nic.prototype.delBatch = function nicDelBatch(opts) {
    var batch = [
        {
            bucket: BUCKET.name,
            key: this.mac.toString(),
            operation: 'delete'
        }
    ];

    // XXX: what to do if this was the primary nic?

    if (this.isUnderlay()) {
        // This is an underlay vnic - remove it from the portolan underlay table
        // so other CNs can no longer reach it.

        batch.push(mod_portolan_moray.underlayMappingDelBatch({
            cn_uuid: this.params.belongs_to_uuid
        }));
    }

    if (this.isFabric()) {
        // This is a fabric vnic - add it to the portolan overlay table
        // so other VMs on the fabric can communicate with it.
        batch.push(mod_portolan_moray.overlayMappingBatch({
            cn_uuid: this.params.cn_uuid,
            deleted: true,
            ip: this.ip.v6address,
            mac: this.mac,
            vnet_id: this.network.vnet_id
        }));

        opts.log.debug({ cns: opts.vnetCns,
            network: this.network, ip: this.ip, etag: this.etag },
            'nic.delBatch specific opts');

        var _vl2batch = mod_portolan_moray.vl2CnEventBatch({
            vnetCns: opts.vnetCns,
            vnet_id: this.network.vnet_id,
            mac: this.mac,
            existingNic: opts.existingNic
        });

        opts.log.debug({
            key: _vl2batch.uuid,
            mac: this.mac,
            vnet_id: this.network.vnet_id,
            batch: batch,
            logBatch: _vl2batch
        }, 'delBatch: creating vl2 shootdown logs for delete');

        batch = batch.concat(_vl2batch);
    }

    if (this.isFabricGateway()) {
        this.network.gateway_provisioned = false;
        batch.push(this.network.batch());
    }

    return batch;
};


/**
 * Returns true if this is a fabric nic
 */
Nic.prototype.isFabric = function isFabric() {
    if (!this.ip || !this.network) {
        return false;
    }

    if (this.params.belongs_to_type === 'zone' && this.network.fabric &&
            this.params.cn_uuid) {
        return true;
    }

    return false;
};


/**
 * Returns true if this is the gateway nic for a fabric network
 */
Nic.prototype.isFabricGateway = function isFabricGateway() {
    if (!this.ip || !this.network || !this.network.fabric) {
        return false;
    }

    if (this.ip.address.toString() === this.network.gatewayAddr) {
        return true;
    }

    return false;
};


/**
 * Returns true if this is an underlay nic
 */
Nic.prototype.isUnderlay = function isUnderlay() {
    if (!this.ip || !this.network) {
        return false;
    }

    var underlayTag = constants.UNDERLAY_TAG;
    if (underlayTag && this.params.underlay &&
            this.params.belongs_to_type === 'server' &&
            this.network.nic_tag === underlayTag) {
        return true;
    }

    return false;
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
        for (var p in NET_PARAMS) {
            if (netSer.hasOwnProperty(NET_PARAMS[p])) {
                serialized[NET_PARAMS[p]] = netSer[NET_PARAMS[p]];
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

    // If on a fabric network, the nic tag is special: it contains the
    // virtual network ID so compute nodes know what overlay network to
    // communicate on.
    // XXX - why not isFabric()? are the checks different in this context?
    if (this.network && this.network.fabric) {
        serialized.nic_tag = fmt('%s/%d', this.network.nic_tag,
            this.network.vnet_id);
    }

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
        state: this.params.state,
        v: BUCKET.version
    };

    if (this.ip && this.network) {
        raw.ipaddr = this.ip.address.toString();
        raw.network_uuid = this.network.uuid;

        if (this.ip.type === 'ipv4') {
            raw.ip = util_ip.aton(raw.ipaddr);
        }
    } else {
        // Try to add what information we do have - for example, when doing
        // migrations, we don't have the fetched ip and network objects
        if (this.params.network_uuid) {
            raw.network_uuid = this.params.network_uuid;
        }

        if (this.params.ipaddr) {
            raw.ip = util_ip.aton(this.params.ipaddr.toString());
            raw.ipaddr = this.params.ipaddr;
        } else if (this.params.ip) {
            raw.ip = this.params.ip;
            raw.ipaddr = util_ip.ntoa(raw.ip);
        }
    }

    BOOL_PARAMS.forEach(function (param) {
        if (self.params[param]) {
            raw[param] = true;
        }
    });

    OPTIONAL_PARAMS.forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            raw[param] = self.params[param];
        }
    });

    // Store nic_tags_provided as a string - this allows it to be indexed
    // properly in moray, which in turn allows searching on all of the values
    if (this.params.hasOwnProperty('nic_tags_provided')) {
        raw.nic_tags_provided =
            mod_moray.arrayToVal(this.params.nic_tags_provided);
        raw.nic_tags_provided_arr = this.params.nic_tags_provided;
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
