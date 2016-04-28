/*
 * Copyright (c) 2015, Joyent, Inc.
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
            belongs_to_type: { type: 'string' },
            belongs_to_uuid: { type: 'string' },
            ipaddr: { type: 'ip' },
            mac: { type: 'number', unique: true },
            network_uuid: { type: 'string' },
            nic_tag: { type: 'string' },
            nic_tags_provided_arr: { type: '[string]' },
            owner_uuid: { type: 'string' },
            primary_flag: { type: 'boolean' },
            v: { type: 'number' },

            // Deprecated indexes, left here in case we need to rollback:
            ip: { type: 'number' },
            nic_tags_provided: { type: 'string' }
        }
    },
    morayVersion: 2,        // moray version must be > than this
    version: 2
};

module.exports = {
    BUCKET: BUCKET
};
