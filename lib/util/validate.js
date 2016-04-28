/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * parameter validation functions
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('./errors');
var fmt = require('util').format;
var jsprim = require('jsprim');
var restify = require('restify');
var util = require('util');
var util_common = require('./common');
var util_ip = require('./ip');
var util_mac = require('./mac');
var verror = require('verror');
var vasync = require('vasync');



// --- Globals



var INTERFACE_NAME_RE = /[a-zA-Z0-9_]{0,31}/;
var INTERFACE_NUM_RE = /[0-9]+$/;
var STR_RE = /\s/g;
var UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
var VALID_STATES = ['provisioning', 'stopped', 'running'];



// --- Internal helpers



/**
 * Calls callback with the appropriate error depending on the contents of errs
 */
function errResult(errs, validated, callback) {
    var invalid = false;

    if (errs.length !== 0) {
        var realErrs = [];
        var sortedErrs = errs.filter(function (e) {
            if (!e.hasOwnProperty('field')) {
                realErrs.push(e);
                return false;
            }
            if (!invalid && e.hasOwnProperty('code') &&
                e.code !== 'MissingParameter') {
                invalid = true;
            }

            return true;
        }).sort(function (a, b) { return (a.field > b.field) ? 1 : -1; });

        if (realErrs.length !== 0) {
            return callback(new restify.InternalError(
                realErrs.length === 1 ? realErrs[0] :
                    new verror.MultiError(realErrs),
                'Internal error'));
        }

        return callback(new errors.InvalidParamsError(
            invalid ? constants.msg.INVALID_PARAMS : 'Missing parameters',
            sortedErrs));
    }

    return callback(null, validated);
}



// --- Exports



/**
 * Validates a boolean value
 */
function validateBoolean(name, val, callback) {
    if (typeof (val) === 'boolean') {
        return callback(null, val);
    }

    if (val === 'true' || val === 'false') {
        return callback(null, val === 'true');
    }

    return callback(new errors.invalidParam(name, 'must be a boolean value'));
}


/**
 * Validates a "fields" array - an array of strings specifying which of an
 * object's fields to return in a response.  `fields` is the list of allowed
 * fields that can be in the array.
 */
function validateFieldsArray(fields, name, arr, callback) {
    if (!util.isArray(arr)) {
        return callback(new errors.invalidParam(name,
                constants.msg.ARRAY_OF_STR));
    }

    if (arr.length === 0) {
        return callback(new errors.invalidParam(name,
                constants.msg.ARRAY_EMPTY));
    }

    if (arr.length >= fields.length) {
        return callback(new errors.invalidParam(name,
            fmt('can only specify a maximum of %d fields',
            fields.length)));
    }

    for (var a in arr) {
        if (typeof (arr[a]) !== 'string') {
            return callback(new errors.invalidParam(name,
                    constants.msg.ARRAY_OF_STR));
        }

        if (fields.indexOf(arr[a]) === -1) {
            return callback(new errors.invalidParam(name,
                'unknown field specified'));
        }
    }

    return callback(null, arr);
}


/**
 * Validates that a name is a valid Illumos interface name
 */
function validateInterfaceName(name, val, callback) {
    validateNicTagName(name, val, function (err) {
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
function validateNicTagName(name, val, callback) {
    validateString(name, val, function (err) {
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
function validateStringArray(name, vals, callback) {
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
function validateStringOrArray(name, val, callback) {
    validateString(name, val, function (err, vals) {
        if (err) {
            return validateStringArray(name, val, callback);
        } else {
            return callback(null, vals);
        }
    });
}


/**
 * Validates an array of IP addresses
 */
function validateIParray(name, arr, callback) {
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
function validateIP(name, addr, callback) {
    var ip = util_ip.toIPAddr(addr);
    if (!ip) {
        return callback(errors.invalidParam(name, constants.INVALID_IP_MSG));
    }

    return callback(null, ip);
}


/**
 * Validates a MAC address
 */
function validateMAC(name, addr, callback) {
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
function validateMACarray(name, val, callback) {
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
function validateString(name, str, callback) {
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
function validateSubnet(name, subnetTxt, callback) {
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

    return callback(null, null, params);
}


/**
 * Validates an MTU
 */
function validateMTU(min, errmsg) {
    var _min = min;
    var _errmsg = errmsg;
    return function _validateMTU(name, val, callback) {
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
 * Validates a UUID
 */
function validateUUID(name, uuid, callback) {
    if (typeof (uuid) !== 'string' || !UUID_RE.test(uuid)) {
        return callback(new errors.invalidParam(name,
                constants.msg.INVALID_UUID));
    }

    return callback(null, uuid);
}


/**
 * Validates an array of UUIDs
 */
function validateUUIDarray(name, val, callback) {
    var arr = util_common.arrayify(val);

    // Dedup the list and find invalid UUIDs
    var invalid = {};
    var valid = {};
    arr.forEach(function (uuid) {
        if (UUID_RE.test(uuid)) {
            valid[uuid] = 1;
        } else {
            invalid[uuid] = 1;
        }
    });

    if (!jsprim.isEmpty(invalid)) {
        var err = new errors.invalidParam(name, 'invalid UUID');
        err.invalid = Object.keys(invalid).sort();
        return callback(err);
    }

    return callback(null, Object.keys(valid).sort());
}


/**
 * Validates a VLAN ID
 */
function validateVLAN(name, vlan_id, callback) {
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
function validateVxlanID(name, vlan_id, callback) {
    var id = Number(vlan_id);
    if (isNaN(id) || id < 0 || id > constants.MAX_VNET_ID) {
        return callback(errors.invalidParam(name, constants.msg.VNET));
    }

    return callback(null, id);
}


/**
 * Validates the nic state is one of a limited set of strings.
 */
function validateNicState(name, state, callback) {
    if (typeof (state) !== 'string') {
        return callback(new errors.invalidParam(name, 'must be a string'));
    }

    if (VALID_STATES.indexOf(state) === -1) {
        return callback(new errors.invalidParam(name, 'must be a valid state'));
    }

    return callback(null, state);
}

function isNotInteger(val, id) {
    assert.string(val);
    return (val === '' || val.trim() !== val || isNaN(id) ||
        Math.floor(id) !== id);
}

/**
 * Checks for valid limits and offsets which are integers greater than or equal
 * to zero. val usually is a string as it comes in from an HTTP query parameter.
 */
function validateOffset(name, val, callback) {
    var id = Number(val);

    if (typeof (val) !== 'number') {
        if (isNotInteger(val, id)) {
            return callback(new errors.invalidParam(name,
                constants.msg.OFFSET));
        }
    }

    if (isNaN(id) || id < constants.MIN_OFFSET) {
        return callback(new errors.invalidParam(name, constants.msg.OFFSET));
    }

    return callback(null, id);
}


/**
 * Checks for valid limits which are integers in the range (0, 1000]. val is
 * usually a string as it comes in from an HTTP query parameter.
 */
function validateLimit(name, val, callback) {
    var id = Number(val);

    if (typeof (val) !== 'number') {
        if (isNotInteger(val, id)) {
            return callback(new errors.invalidParam(name,
                constants.msg.LIMIT));
        }
    }

    if (isNaN(id) || id < constants.MIN_LIMIT || id > constants.MAX_LIMIT) {
        return callback(new errors.invalidParam(name, constants.msg.LIMIT));
    }

    return callback(null, id);
}

/**
 * Check for any uknown parameters if strict mode is engaged.
 */
function validateUnknowns(params, req, opt) {
    var field;
    var unknowns = [];

    for (field in params) {
        if (!params.hasOwnProperty(field)) {
            continue;
        }
        if ((req && req.hasOwnProperty(field)) ||
           (opt && opt.hasOwnProperty(field))) {
            continue;
        }

        unknowns.push(field);
    }

    if (unknowns.length === 0) {
        return null;
    }

    return new errors.unknownParams(unknowns);
}


/**
 * Validate parameters
 */
function validateParams(opts, callback) {
    var errs = [];
    var field;
    var validatedParams = {};

    assert.object(opts, 'opts');
    assert.object(opts.params, 'opts.params');
    assert.optionalObject(opts.params.required, 'opts.params.required');
    assert.optionalObject(opts.params.optional, 'opts.params.optional');
    assert.func(callback);

    var toValidate = [];

    for (field in opts.required) {
        assert.func(opts.required[field],
            fmt('opts.required[%s]', field));

        if (opts.params.hasOwnProperty(field)) {
            toValidate.push({
                field: field,
                fn: opts.required[field],
                val: opts.params[field]
            });
        } else {
            errs.push(errors.missingParam(field));
        }
    }

    for (field in opts.optional) {
        assert.func(opts.optional[field],
            fmt('opts.required[%s]', field));

        if (opts.params.hasOwnProperty(field)) {
            toValidate.push({
                field: field,
                fn: opts.optional[field],
                val: opts.params[field]
            });
        }
    }

    vasync.forEachParallel({
        inputs: toValidate,
        func: function _callValidateFn(val, cb) {
            // TODO: allow specifying an array of validation functions, and bail
            // after the first failure

            val.fn(val.field, val.val, function (e, validated, multi) {
                if (e) {
                    errs.push(e);
                }

                if (typeof (validated) !== 'undefined') {
                    validatedParams[val.field] = validated;

                    // if (typeof (validated) === 'object' &&
                    //     !validated.hasOwnProperty('length')) {
                    //     for (var v in validated) {
                    //         validatedParams[v] = validated[v];
                    //     }
                    // } else {
                    //     validatedParams[val.field] = validated;
                    // }

                }
                if (typeof (multi) !== 'undefined' &&
                    typeof (multi) === 'object') {

                    for (var v in multi) {
                        validatedParams[v] = multi[v];
                    }
                }

                return cb();
            });
        }
    }, function after() {
        if (opts.strict) {
            var err = validateUnknowns(opts.params, opts.required,
                opts.optional);
            if (err !== null) {
                errs.push(err);
            }
        }

        if (opts.hasOwnProperty('after') && errs.length === 0) {
            if (!Array.isArray(opts.after)) {
                opts.after = [opts.after];
            }
            return crossValidate(errs, opts.params, validatedParams,
                opts.after, callback);
        }
        return errResult(errs, validatedParams, callback);
    });
}

/**
 * Used by validate.params to call an array of 'after' functions, which have
 * access to all the raw and validated parameters. This is typically used to
 * validate conditions between parameters, e.g., nicTag/network MTUs.
 */
function crossValidate(errs, raw, validated, afterFuncs, callback) {
    vasync.forEachPipeline({
        inputs: afterFuncs,
        func: function _validate(func, cb) {
            func(raw, validated, function (err) {
                if (err) {
                    if (Array.isArray(err)) {
                        errs = errs.concat(err);
                    } else {
                        errs.push(err);
                    }
                }
                return cb();
            });
        }
    }, function (_, _results) {
        return errResult(errs, validated, callback);
    });
}

module.exports = {
    bool: validateBoolean,
    fieldsArray: validateFieldsArray,
    IP: validateIP,
    ipArray: validateIParray,
    interfaceName: validateInterfaceName,
    limit: validateLimit,
    MAC: validateMAC,
    MACarray: validateMACarray,
    nicTagMTU: validateMTU(constants.MTU_NICTAG_MIN,
        constants.MTU_NICTAG_INVALID_MSG),
    networkMTU: validateMTU(constants.MTU_NETWORK_MIN,
        constants.MTU_NETWORK_INVALID_MSG),
    nicState: validateNicState,
    nicTagName: validateNicTagName,
    offset: validateOffset,
    params: validateParams,
    string: validateString,
    stringOrArray: validateStringOrArray,
    stringArray: validateStringArray,
    subnet: validateSubnet,
    UUID: validateUUID,
    UUIDarray: validateUUIDarray,
    VLAN: validateVLAN,
    VxLAN: validateVxlanID
};
