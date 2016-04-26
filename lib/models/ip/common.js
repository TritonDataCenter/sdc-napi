/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * ip model: common code
 */

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../../util/constants');
var mod_moray = require('../../apis/moray');
var util = require('util');
var util_ip = require('../../util/ip');



// --- Globals



var BUCKET = {
    desc: 'IP',
    // name intentionally left out here: this is per-network
    schema: {
        index: {
            belongs_to_type: { type: 'string' },
            belongs_to_uuid: { type: 'string' },
            owner_uuid: { type: 'string' },
            ip: { type: 'number', unique: true },
            ipaddr: { type: 'ip', unique: true },
            reserved: { type: 'boolean' },
            v: { type: 'number' }
        }
    },
    version: 2
};
// Object params that are not required - note that setting any of
// these (or reserved) will result in the "free" property being set to false
// in the API.
var OPTIONAL_PARAMS = [
    'belongs_to_type',
    'belongs_to_uuid',
    'owner_uuid'
];



// --- IP object



/**
 * IP object constructor
 */
function IP(params) {
    this.params = params;

    if (this.params.ipaddr) {
        this.params.ip = util_ip.toIPAddr(params.ipaddr);
    } else {
        this.params.ip = util_ip.toIPAddr(params.ip);
    }

    // XXX: assert in params:
    // * ip
    // * network_uuid

    if (params.hasOwnProperty('reserved') &&
        typeof (params.reserved) !== 'boolean') {
        this.params.reserved = params.reserved === 'true' ? true : false;
    }

    if (params.hasOwnProperty('etag')) {
        this.etag = params.etag;
    } else {
        this.etag = null;
    }

    this.use_strings = params.use_strings ||
        (params.network && params.network.ip_use_strings);
}

Object.defineProperty(IP.prototype, 'address', {
    get: function () { return this.params.ip; }
});

Object.defineProperty(IP.prototype, 'reserved', {
    set: function (r) { this.params.reserved = r; }
});

Object.defineProperty(IP.prototype, 'type', {
    get: function () { return this.params.ip.kind(); }
});

Object.defineProperty(IP.prototype, 'v6address', {
    get: function () {
        var ipObj = this.params.ip;

        if (ipObj.kind() == 'ipv4') {
            ipObj = ipObj.toIPv4MappedAddress();
        }

        return ipObj.toString();
    }
});


/**
 * Returns an object suitable for passing to a moray batch
 */
IP.prototype.batch = function ipBatch(opts) {
    var batchObj = {
        bucket: bucketName(this.params.network_uuid),
        key: this.key(),
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag
        }
    };

    if (opts && opts.free) {
        var value = this.params.ip.toString();

        batchObj.value = {
            reserved: false
        };

        if (this.use_strings) {
            batchObj.value.ipaddr = util_ip.aton(value).toString();
        } else {
            batchObj.value.ip = util_ip.aton(value).toString();
        }
    }

    return batchObj;
};


/**
 * Get the key for this IP address in its network's bucket
 */
IP.prototype.key = function ipKey() {
    return getIPKey(this.use_strings, this.address);
};


/**
 * Returns true if this IP can be provisioned
 */
IP.prototype.provisionable = function ipProvisionable(opts) {
    if (!this.params.belongs_to_uuid || !this.params.belongs_to_type) {
        return true;
    }

    // Allow "other" IPs to be taken - these are usually records created when
    // the network is created, like resolvers and gateway
    if (this.params.belongs_to_type === 'other' &&
        this.params.belongs_to_uuid === constants.UFDS_ADMIN_UUID) {
        return true;
    }

    return false;
};


/**
 * Returns the serialized form of the IP, suitable for public consumption
 */
IP.prototype.serialize = function ipSerialize() {
    var self = this;
    var ser =  {
        ip: this.params.ip.toString(),
        reserved: this.params.reserved ? true : false,
        free: this.params.reserved ? false : true
    };

    OPTIONAL_PARAMS.forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            ser[param] = self.params[param];
            ser.free = false;
        }
    });

    if (this.params.hasOwnProperty('network_uuid')) {
        ser.network_uuid = this.params.network_uuid;
    }

    return ser;
};


/**
 * Returns the raw form suitable for storing in moray
 */
IP.prototype.raw = function ipRaw() {
    var self = this;

    var raw = {
        reserved: this.params.reserved ? true : false,
        use_strings: this.use_strings
    };

    if (this.use_strings) {
        raw.ipaddr = this.params.ip.toString();
        raw.v = BUCKET.version;
    } else {
        raw.ip = util_ip.addressToNumber(this.params.ip.toString()).toString();
    }

    OPTIONAL_PARAMS.forEach(function (param) {
        if (self.params.hasOwnProperty(param)) {
            raw[param] = self.params[param];
        }
    });

    return raw;
};



// --- Exports

/**
 * Given an address, get the appropriate Moray key to search
 * for in an IP bucket.
 */
function getIPKey(use_strings, ipaddr) {
    if (!use_strings) {
        return util_ip.addressToNumber(ipaddr.toString()).toString();
    } else {
        return ipaddr.toString();
    }
}


/**
 * Returns the bucket name for a network
 */
function bucketName(networkUUID) {
    return mod_moray.bucketName(util.format('napi_ips_%s',
        networkUUID.replace(/-/g, '_')));
}


/*
 * Convert an IP (address or string) to integer form
 */
function ipToNumber(ip) {
    if (isNaN(ip)) {
        ip = util_ip.aton(ip);
    }
    return ip;
}


/**
 * Returns the bucket for a network
 */
function getBucketObj(networkUUID) {
    var newBucket = clone(BUCKET);
    newBucket.name = bucketName(networkUUID);
    return newBucket;
}



module.exports = {
    BUCKET: BUCKET,
    bucketName: bucketName,
    getBucketObj: getBucketObj,
    getIPKey: getIPKey,
    IP: IP
};
