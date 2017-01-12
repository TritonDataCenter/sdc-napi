/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * nic model: bucket definition. This lives in its own file so it's easier to
 * deal with the circular dependency between nic and network models.
 */

'use strict';

// You can't use Postgres reserved keywords as column names, so
// primary gets mapped to primary_flag. See:
// http://www.postgresql.org/docs/current/static/sql-keywords-appendix.html
var BUCKET = {
    desc: 'nic',
    name: 'napi_nics',
    schema: {
        index: {
            admin: { type: 'boolean' },
            allow_dhcp_spoofing: { type: 'boolean' },
            allow_ip_spoofing: { type: 'boolean' },
            allow_mac_spoofing: { type: 'boolean' },
            allow_restricted_traffic: { type: 'boolean' },
            allow_unfiltered_promisc: { type: 'boolean' },
            belongs_to_type: { type: 'string' },
            belongs_to_uuid: { type: 'string' },
            cn_uuid: { type: 'string' },
            created_timestamp: { type: 'number' },
            ipaddr: { type: 'ip' },
            mac: { type: 'number', unique: true },
            modified_timestamp: { type: 'number' },
            network_uuid: { type: 'string' },
            nic_tag: { type: 'string' },
            nic_tags_provided_arr: { type: '[string]' },
            owner_uuid: { type: 'string' },
            primary_flag: { type: 'boolean' },
            state: { type: 'string' },
            underlay: { type: 'boolean' },
            v: { type: 'number' },

            // Deprecated indexes, left here in case we need to rollback:
            ip: { type: 'number' },
            nic_tags_provided: { type: 'string' }
        }
    },
    morayVersion: 2,        // moray version must be > than this
    version: 3
};

module.exports = {
    BUCKET: BUCKET
};
