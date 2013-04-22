/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Shared constants
 */

var ADMIN_UUID;


module.exports = {
    get UFDS_ADMIN_UUID() {
        return ADMIN_UUID;
    },
    set UFDS_ADMIN_UUID(val) {
        ADMIN_UUID = val;
    },
    OWNER_MATCH_MSG: 'network owner_uuid does not match',
    POOL_FULL_MSG: 'all networks in pool are full',
    POOL_IP_MSG: 'IP cannot be specified with a network pool',
    SUBNET_FULL_MSG: 'no more free IPs',
    VLAN_MSG: 'VLAN ID must be a number between 0 and 4094, and not 1'
};
