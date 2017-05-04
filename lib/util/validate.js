/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * parameter validation functions
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('./errors');
var fmt = require('util').format;
var ipaddr = require('ip6addr');
var util = require('util');
var util_common = require('./common');
var util_ip = require('./ip');
var util_mac = require('./mac');
var warden = require('restify-warden');



// --- Globals



var INTERFACE_NAME_RE = /[a-zA-Z0-9_]{0,31}/;
var INTERFACE_NUM_RE = /[0-9]+$/;
var STR_RE = /\s/g;


// --- Internal helpers



// --- Exports



/**
 * Validates a boolean value
 */
function validateBoolean(_, name, val, callback) {
    if (typeof (val) === 'boolean') {
        return callback(null, val);
    }

    if (val === 'true' || val === 'false') {
        return callback(null, val === 'true');
    }

    return callback(new errors.invalidParam(name, 'must be a boolean value'));
}


/**
 * Validates that a value is one of the values present in an array that
 * enumerates all allowed values.
 */
function validateEnum(values) {
    assert.array(values, 'values');
    return function _validateEnum(_, name, value, callback) {
        if (values.indexOf(value) === -1) {
            callback(new errors.invalidParam(name,
                'must be one of: ' + values.map(JSON.stringify).join(', ')));
            return;
        }

        callback(null, value);
    };
}

/**
 * Validates that a name is a valid illumos interface name
 */
function validateInterfaceName(_, name, val, callback) {
    validateNicTagName(null, name, val, function (err) {
        if (err) {
            return callback(err);
        }

        if (!INTERFACE_NUM_RE.test(val)) {
            return callback(errors.invalidParam(name, 'must end in a number'));
        }

        return callback(null, val);
    });
}


/**
 * Validates a valid nic tag name
 */
function validateNicTagName(_, name, val, callback) {
    validateString(null, name, val, function (err) {
        if (err) {
            return callback(err);
        }

        if (val.length > constants.MAX_INTERFACE_LEN) {
            return callback(errors.invalidParam(name,
                fmt('must not be longer than %d characters',
                    constants.MAX_INTERFACE_LEN)));
        }

        if (val && val.replace(INTERFACE_NAME_RE, '') !== '') {
            return callback(errors.invalidParam(name,
                'must only contain numbers, letters and underscores'));
        }

        return callback(null, val);
    });
}


/**
 * Validates an array of nic tags
 */
function validateStringArray(_, name, vals, callback) {
    if (!util.isArray(vals)) {
        return callback(new errors.invalidParam(name,
                constants.msg.ARRAY_OF_STR));
    }

    if (vals.length === 0) {
        return callback(new errors.invalidParam(name,
                constants.msg.ARRAY_EMPTY));
    }

    for (var i = 0; i < vals.length; i++) {
        var v = vals[i];
        if (typeof (v) !== 'string') {
            return callback(new errors.invalidParam(name,
                    constants.msg.ARRAY_OF_STR));
        }
    }

    return callback(null, vals);
}

/**
 * Validates something is either a string or an array of strings.
 */
function validateStringOrArray(_, name, val, callback) {
    validateString(null, name, val, function (err, vals) {
        if (err) {
            return validateStringArray(null, name, val, callback);
        } else {
            return callback(null, vals);
        }
    });
}


/**
 * Validates an array of IP addresses
 */
function validateIParray(_, name, arr, callback) {
    var errs = [];
    var ips = [];

    if (!util.isArray(arr) && typeof (arr) !== 'string') {
        return callback(new errors.invalidParam(name,
            constants.msg.ARRAY_OF_STR));
    }

    // UFDS will return a scalar if there's only one IP. Also allow
    // comma-separated IPs from the commandline tools
    util_common.arrayify(arr).forEach(function (i) {
        if (typeof (i) !== 'string') {
            errs.push(i);
            return;
        }

        var ip = i.replace(/\s+/, '');
        if (!ip) {
            return;
        }
        var ipAddr = util_ip.toIPAddr(ip);

        if (!ipAddr) {
            errs.push(ip);
        } else {
            ips.push(ipAddr);
        }
    });

    if (errs.length !== 0) {
        var ipErr = errors.invalidParam(name,
            fmt('invalid IP%s', errs.length === 1 ? '' : 's'));
        ipErr.invalid = errs;
        return callback(ipErr);
    }

    return callback(null, ips);
}


/**
 * Validates an IP address
 */
function validateIP(_, name, addr, callback) {
    var ip = util_ip.toIPAddr(addr);
    if (!ip) {
        return callback(errors.invalidParam(name, constants.INVALID_IP_MSG));
    }

    return callback(null, ip);
}


/**
 * Validates an IPv4 address
 */
function validateIPv4(_, name, addr, callback) {
    var ip = util_ip.toIPAddr(addr);
    if (!ip) {
        callback(errors.invalidParam(name, constants.INVALID_IP_MSG));
        return;
    }

    if (ip.kind() !== 'ipv4') {
        callback(errors.invalidParam(name, constants.IPV4_REQUIRED));
        return;
    }

    callback(null, ip);
}


/**
 * Validates a MAC address
 */
function validateMAC(_, name, addr, callback) {
    var macNum = util_mac.aton(addr);

    if (!macNum) {
        return callback(errors.invalidParam(name,
            'invalid MAC address'));
    }

    return callback(null, macNum);
}


/**
 * Validates an array of MAC addresses
 */
function validateMACarray(_, name, val, callback) {
    var arr = util_common.arrayify(val);
    var errs = [];
    var macs = [];

    for (var m in arr) {
        var macNum = util_mac.aton(arr[m]);
        if (macNum) {
            macs.push(macNum);
        } else {
            errs.push(arr[m]);
        }
    }

    if (errs.length !== 0) {
        var macErr = errors.invalidParam(name,
            fmt('invalid MAC address%s',
                errs.length === 1 ? '' : 'es'));
        macErr.invalid = errs;
        return callback(macErr);
    }

    return callback(null, macs);
}


/**
 * Validates a string: ensures it's not empty
 */
function validateString(_, name, str, callback) {
    if (typeof (str) !== 'string') {
        return callback(new errors.invalidParam(name, constants.msg.STR));
    }

    if (str.length > constants.MAX_STR_LEN) {
        return callback(new errors.invalidParam(name,
            fmt('must not be longer than %d characters',
                constants.MAX_STR_LEN)));
    }

    if (str.replace(STR_RE, '') === '') {
        return callback(new errors.invalidParam(name, 'must not be empty'));
    }

    return callback(null, str);
}


/**
 * Validates a subnet
 */
function validateSubnet(_, name, subnetTxt, callback) {
    var params = {};

    if (typeof (subnetTxt) !== 'string') {
        return callback(errors.invalidParam(name, constants.msg.STR));
    }

    var subnet = subnetTxt.split('/');

    function validIPv4SubnetBits(obj) {
        return obj.subnet_start.kind() === 'ipv4' &&
            obj.subnet_bits >= constants.SUBNET_MIN_IPV4 &&
            obj.subnet_bits <= 32;
    }

    function validIPv6SubnetBits(obj) {
        return obj.subnet_start.kind() === 'ipv6' &&
            obj.subnet_bits >= constants.SUBNET_MIN_IPV6 &&
            obj.subnet_bits <= 128;
    }

    if (subnet.length !== 2) {
        return callback(errors.invalidParam(name, constants.msg.CIDR));
    }

    var ip = util_ip.toIPAddr(subnet[0]);
    if (!ip) {
        return callback(errors.invalidParam(name, constants.msg.CIDR_IP));
    }

    params.subnet_start = ip;
    params.subnet_bits = Number(subnet[1]);
    params[name] = subnetTxt;

    if (isNaN(params.subnet_bits) ||
        (!validIPv4SubnetBits(params) && !validIPv6SubnetBits(params))) {
        return callback(errors.invalidParam(name, constants.msg.CIDR_BITS));
    }

    var cidr = ipaddr.createCIDR(ip, params.subnet_bits);

    if (cidr.address().compare(ip) !== 0) {
        return callback(errors.invalidParam(name, constants.msg.CIDR_INVALID));
    }

    return callback(null, null, params);
}


/**
 * Validates an MTU
 */
function validateMTU(min, errmsg) {
    var _min = min;
    var _errmsg = errmsg;
    return function _validateMTU(_, name, val, callback) {
        if (typeof (val) !== 'number') {
            return callback(new errors.invalidParam(name, _errmsg));
        }

        if (val < _min || val > constants.MTU_MAX) {
            return callback(new errors.invalidParam(name, _errmsg));
        }

        return callback(null, val);
    };
}

/**
 * Validates a VLAN ID
 */
function validateVLAN(_, name, vlan_id, callback) {
    var id = Number(vlan_id);
    if (isNaN(id) || id < 0 ||
        id === 1 || id > 4094) {
        return callback(errors.invalidParam(name, constants.VLAN_MSG));
    }

    return callback(null, id);
}


/**
 * Validates a VxLAN ID
 */
function validateVxlanID(_, name, vlan_id, callback) {
    var id = Number(vlan_id);

    if (parseInt(vlan_id, 10) !== id || id < 0 || id > constants.MAX_VNET_ID) {
        callback(errors.invalidParam(name, constants.msg.VNET));
        return;
    }

    callback(null, id);
}


module.exports = {
    bool: validateBoolean,
    enum: validateEnum,
    fieldsArray: warden.fieldsArray,
    IP: validateIP,
    IPv4: validateIPv4,
    ipArray: validateIParray,
    interfaceName: validateInterfaceName,
    limit: warden.limit,
    MAC: validateMAC,
    MACarray: validateMACarray,
    nicTagMTU: validateMTU(constants.MTU_NICTAG_MIN,
        constants.MTU_NICTAG_INVALID_MSG),
    networkMTU: validateMTU(constants.MTU_NETWORK_MIN,
        constants.MTU_NETWORK_INVALID_MSG),
    nicTagName: validateNicTagName,
    offset: warden.offset,
    params: warden.params,
    string: validateString,
    stringOrArray: validateStringOrArray,
    stringArray: validateStringArray,
    subnet: validateSubnet,
    UUID: warden.UUID,
    UUIDarray: warden.UUIDarray,
    VLAN: validateVLAN,
    VxLAN: validateVxlanID
};
