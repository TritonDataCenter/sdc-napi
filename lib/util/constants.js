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
    OWNER_MATCH_MSG: 'network owner_uuids do not match',
    POOL_FULL_MSG: 'all networks in pool are full',
    POOL_IP_MSG: 'IP cannot be specified with a network pool',
    POOL_OWNER_MATCH_MSG:
        'network owner_uuids do not match the owner_uuids of the pool',
    POOL_TAGS_MATCH_MSG:
        'nic tags of all networks in a network pool must match',
    SUBNET_FULL_MSG: 'no more free IPs',
    SUBNET_MIN: 8,
    VLAN_MSG: 'VLAN ID must be a number between 0 and 4094, and not 1'
};
