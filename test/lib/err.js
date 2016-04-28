/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Error helpers
 */

'use strict';

var constants = require('../../lib/util/constants');
var errors = require('../../lib/util/errors');
var util = require('util');



// --- Globals



var MESSAGES = {
    cidr: constants.msg.CIDR,
    cidrBits: constants.msg.CIDR_BITS,
    cidrIP: constants.msg.CIDR_IP,
    cidrInvalid: constants.msg.CIDR_INVALID,
    emptyArray: constants.msg.ARRAY_EMPTY,
    ip: 'invalid IP',
    longStr: 'must not be longer than 64 characters',
    obj: constants.msg.OBJ,
    str: constants.msg.STR,
    route: 'invalid route',
    strArray: constants.msg.ARRAY_OF_STR,
    uuid: constants.msg.INVALID_UUID,
    vlan: constants.VLAN_MSG
};



// --- Exports



/**
 * Return an error for an overlapping subnet
 */
function invalidParamErr(param, msg, invalid) {
    var body = new errors.InvalidParamsError(constants.msg.INVALID_PARAMS,
        [ errors.invalidParam(param, msg) ]).body;

    if (invalid) {
        body.errors[0].invalid = invalid;
    }

    return body;
}


/**
 * Return a "network must have no nics provisioned" error
 */
function netHasNicsErr(nics) {
    var usedBy = nics.map(function (nic) {
        return errors.usedBy('nic', nic.mac);
    }).sort(function (a, b) {
        return a.id < b.id;
    });
    return new errors.InUseError(constants.msg.NIC_ON_NET, usedBy).body;
}



/**
 * Return a "network name in use" error
 */
function netNameInUseErr() {
    return new errors.InvalidParamsError(constants.msg.NET_NAME_IN_USE,
        [ errors.duplicateParam('name') ]).body;
}


/**
 * Return a "type not found" error
 */
function notFoundErr(type) {
    return {
        code: 'ResourceNotFound',
        message: type + ' not found'
    };
}


/**
 * Return an error for an overlapping subnet
 */
function subnetOverlapErr(nets) {
    if (!util.isArray(nets)) {
        nets = [ nets ];
    }

    return new errors.InvalidParamsError(constants.msg.INVALID_PARAMS,
        errors.networkOverlapParams(nets)).body;
}


/**
 * Return a "VLAN in use" error
 */
function vlanInUseErr() {
    return new errors.InUseError(constants.msg.VLAN_USED, [
        errors.duplicateParam('vlan_id', constants.msg.VLAN_USED)
    ]).body;
}

/**
 * Return a "vlan must have no networks" error
 */
function vlanHasNetworksErr(nets) {
    var usedBy = nets.map(function (net) {
        return errors.usedBy('network', net.uuid);
    }).sort(function (a, b) {
        return a.id < b.id;
    });
    return new errors.InUseError(constants.msg.NET_ON_VLAN, usedBy).body;
}


module.exports = {
    invalidParam: invalidParamErr,
    msg: MESSAGES,
    netHasNicsErr: netHasNicsErr,
    netNameInUse: netNameInUseErr,
    notFound: notFoundErr,
    subnetOverlap: subnetOverlapErr,
    vlanInUse: vlanInUseErr,
    vlanHasNetworks: vlanHasNetworksErr
};
