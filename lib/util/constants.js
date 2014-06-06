/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Shared constants
 */

var ADMIN_UUID;
var MESSAGES = {
    AGGR_BELONGS: 'all nics must have belongs_to_uuid of type server',
    AGGR_MATCH: 'belongs_to_uuid must match for all nics in the aggregation',
    AGGR_NAME: 'aggregation with same belongs_to_uuid and name already exists'
};
// Messages that need to be formatted with util.format
var FORMAT_MESSAGES = {
    IP_EXISTS: 'IP exists on network %s',
    IP_IN_USE: 'IP in use by %s "%s"'
};


module.exports = {
    get UFDS_ADMIN_UUID() {
        return ADMIN_UUID;
    },
    set UFDS_ADMIN_UUID(val) {
        ADMIN_UUID = val;
    },
    fmt: FORMAT_MESSAGES,
    GATEWAY_SUBNET_MSG: 'gateway cannot be outside subnet',
    INVALID_IP_MSG: 'invalid IP address',
    IP_PROVISION_RETRIES: 20,
    msg: MESSAGES,
    MAC_RETRIES: 50,
    MAX_INTERFACE_LEN: 31,
    OWNER_MATCH_MSG: 'network owner_uuids do not match',
    POOL_FULL_MSG: 'all networks in pool are full',
    POOL_IP_MSG: 'IP cannot be specified with a network pool',
    POOL_MIN_NETS_MSG:
        'network pool must contain at least one network',
    POOL_OWNER_MATCH_MSG:
        'network owner_uuids do not match the owner_uuids of the pool',
    POOL_TAGS_MATCH_MSG:
        'nic tags of all networks in a network pool must match',
    PROV_RANGE_ORDER_MSG:
        'provision_start_ip must be before provision_end_ip',
    SUBNET_FULL_MSG: 'no more free IPs',
    SUBNET_MIN: 8,
    VLAN_MSG: 'VLAN ID must be a number between 0 and 4094, and not 1'
};
