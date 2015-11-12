/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Shared constants
 */

var MESSAGES = {
    AGGR_BELONGS: 'all nics must have belongs_to_uuid of type server',
    AGGR_MATCH: 'belongs_to_uuid must match for all nics in the aggregation',
    AGGR_NAME: 'aggregation with same belongs_to_uuid and name already exists',
    ARRAY_OF_STR: 'must be an array of strings',
    ARRAY_EMPTY: 'must not be an empty array',
    CIDR: 'Subnet must be in CIDR form',
    CIDR_IP: 'Subnet IP invalid',
    CIDR_BITS: 'Subnet bits invalid',
    CIDR_INVALID: 'invalid CIDR format',
    INVALID_PARAMS: 'Invalid parameters',
    INVALID_UUID: 'invalid UUID',
    IP_NO_VLAN_TAG: 'required if IP specified but not network_uuid',
    IP_OUTSIDE: 'ip cannot be outside subnet',
    LIMIT: 'invalid limit, must be an integer greater than 0 or less than or ' +
        'equal to 1000',
    NET_NAME_IN_USE: 'name is in use by another network',
    NET_OWNER: 'owner cannot provision on network',
    NET_ON_VLAN: 'VLAN must have no networks',
    NIC_ON_NET: 'network must have no NICs provisioned',
    OBJ: 'must be an object',
    OFFSET: 'invalid value, offset must be an integer greater than or ' +
        'equal to 0',
    OVERLAY_REQIRED: 'overlay networking is not enabled',
    POOL_OWNER: 'owner cannot provision on network pool',

    PROV_END_IP_OUTSIDE: 'provision_end_ip cannot be outside subnet',
    PROV_END_IP_BCAST: 'provision_end_ip cannot be the broadcast address',
    PROV_START_IP_BCAST: 'provision_start_ip cannot be the broadcast address',
    PROV_START_IP_OUTSIDE: 'provision_start_ip cannot be outside subnet',
    PROV_TYPES_MISMATCH: 'provision_start_ip and provision_end_ip must be ' +
        'both IPv4 or both IPv6 addresses',
    PROV_START_TYPE_MISMATCH: 'provision_start_ip and subnet must both be ' +
        'IPv4 or IPv6 addresses',
    PROV_END_TYPE_MISMATCH: 'provision_end_ip and subnet must both be ' +
        'IPv4 or IPv6 addresses',

    SEARCH_NO_NETS: 'No networks found containing that IP address',
    STR: 'must be a string',
    UNKNOWN_PARAMS: 'Unknown parameters',
    VLAN_USED: 'VLAN ID is already in use',
    VNET: 'VNET ID must be a number between 0 and 16777215'
};

// Messages that need to be formatted with util.format
var FORMAT_MESSAGES = {
    IP_EXISTS: 'IP exists on network %s',
    IP_IN_USE: 'IP in use by %s "%s"',
    IP_INVALID: 'Invalid IP %s',
    IP_OUTSIDE: 'IP address %s is outside the subnet for given network %s',
    IP_NONET: 'No networks matching this nic_tag ("%s") and vlan_id (%d) ' +
        'contained the IP address %s',
    IP_MULTI: 'Multiple (overlapping) networks (%s) matching this nic_tag ' +
        'and vlan_id contain the IP address %s'
};

var ADMIN_UUID;
var FABRICS_ENABLED = false;
var MAX_VNET_ID = 16777215;     // 24 bits
var MTU_MAX = 9000;
var MTU_NICTAG_MIN = 1500;
var MTU_NETWORK_MIN = 576;
var MTU_DEFAULT = 1500;
var OVERLAY_MTU;
var OVERLAY_NIC_TAG;
var UNDERLAY_NIC_TAG;


module.exports = {
    get FABRICS_ENABLED() {
        return FABRICS_ENABLED;
    },
    set FABRICS_ENABLED(val) {
        FABRICS_ENABLED = val;
    },
    get UFDS_ADMIN_UUID() {
        return ADMIN_UUID;
    },
    set UFDS_ADMIN_UUID(val) {
        ADMIN_UUID = val;
    },
    get UNDERLAY_TAG() {
        return UNDERLAY_NIC_TAG;
    },
    set UNDERLAY_TAG(val) {
        UNDERLAY_NIC_TAG = val;
    },
    get OVERLAY_MTU() {
        return OVERLAY_MTU;
    },
    set OVERLAY_MTU(val) {
        OVERLAY_MTU = val;
    },
    get OVERLAY_TAG() {
        return OVERLAY_NIC_TAG;
    },
    set OVERLAY_TAG(val) {
        OVERLAY_NIC_TAG = val;
    },

    fmt: FORMAT_MESSAGES,
    ADMIN_MTU_MSG: 'admin nic tag mtu must be ' + MTU_DEFAULT,
    ADMIN_UPDATE_MSG: 'admin nic tag cannot be updated',
    DEFAULT_NIC_STATE: 'provisioning',
    DEFAULT_LIMIT: 1000,
    DEFAULT_OFFSET: 0,
    EXTERNAL_RENAME_MSG: 'external nic tag cannot be renamed',
    GATEWAY_SUBNET_MSG: 'gateway cannot be outside subnet',
    INVALID_IP_MSG: 'invalid IP address',
    IP_PROVISION_RETRIES: 20,
    msg: MESSAGES,
    MAC_RETRIES: 50,
    MAX_INTERFACE_LEN: 31,
    MAX_LIMIT: 1000,
    MAX_STR_LEN: 64,
    MAX_VNET_ID: MAX_VNET_ID,
    MIN_LIMIT: 1,
    MIN_OFFSET: 0,
    MTU_MAX: MTU_MAX,
    MTU_NETWORK_MIN: MTU_NETWORK_MIN,
    MTU_NICTAG_MIN: MTU_NICTAG_MIN,
    MTU_DEFAULT: MTU_DEFAULT,
    MTU_NICTAG_INVALID_MSG: 'mtu must be a number between ' + MTU_NICTAG_MIN +
        ' and ' + MTU_MAX,
    MTU_NETWORK_INVALID_MSG: 'mtu must be a number between ' +
        MTU_NETWORK_MIN + ' and ' + MTU_MAX,
    MTU_NETWORK_GT_NICTAG: 'network mtu must be under nic_tag mtu',
    MTU_NICTAG_UPDATE_MSG: 'nic_tag mtu update must support existing networks',
    OWNER_MATCH_MSG: 'network owner_uuids do not match',
    POOL_FULL_MSG: 'all networks in pool are full',
    POOL_IP_MSG: 'IP cannot be specified with a network pool',
    POOL_MIN_NETS_MSG:
        'network pool must contain at least one network',
    POOL_OWNER_MATCH_MSG:
        'network owner_uuids do not match the owner_uuids of the pool',
    POOL_TAGS_MATCH_MSG:
        'nic tags of all networks in a network pool must match',
    PRIV_RANGE_ONLY: 'subnet must be within private ranges',
    PROV_RANGE_ORDER_MSG:
        'provision_start_ip must be before provision_end_ip',
    SUBNET_FULL_MSG: 'no more free IPs',
    SUBNET_GATEWAY_MISMATCH: 'gateway should match subnet type (%s)',
    SUBNET_RESOLVER_MISMATCH: 'resolvers should match subnet type (%s)',
    SUBNET_ROUTE_DST_MISMATCH:
        'addresses used for routing should match subnet type (%s)',
    SUBNET_MIN_IPV4: 8,
    SUBNET_MIN_IPV6: 8,
    VLAN_MSG: 'VLAN ID must be a number between 0 and 4094, and not 1',
    VXLAN_PORT: 4789
};
