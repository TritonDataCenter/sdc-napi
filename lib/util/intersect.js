/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * This file contains the logic for finding the intersections of network pools
 * during provisioning. Network pools intersect when they contain networks that
 * have the same values for the following properties:
 *
 * - "mtu"
 * - "nic_tag"
 * - "vlan_id"
 * - "vnet_id"
 *
 * The significance of these properties is that a VNIC can only have them set to
 * a single value, so we can't select addresses from networks that differ.
 *
 * Given multiple pools, we search for all combinations of these properties
 * that would provide a subset of usable networks from every pool. For example,
 * consider an attempt to provision a NIC on the following two network pools,
 * one IPv4 and the other IPv6:
 *
 * [
 *   { subnet: "10.0.0.0/24", nic_tag: "r1internal", mtu: 1500, vlan_id: 21 },
 *   { subnet: "10.0.1.0/24", nic_tag: "r2internal", mtu: 1500, vlan_id: 22 },
 *   { subnet: "10.0.2.0/24", nic_tag: "r2internal", mtu: 1500, vlan_id: 23 },
 *   { subnet: "10.0.3.0/24", nic_tag: "r2internal", mtu: 8500, vlan_id: 23 }
 * ]
 *
 * [
 *   { subnet: "fd00::/64", nic_tag: "r1internal", mtu: 1500, vlan_id: 21 },
 *   { subnet: "fd01::/64", nic_tag: "r2internal", mtu: 1500, vlan_id: 22 },
 *   { subnet: "fd02::/64", nic_tag: "r2internal", mtu: 1500, vlan_id: 23 }
 * ]
 *
 * One of the IPv4 networks can't be used with any of the IPv6 networks due to
 * its higher MTU, and all of the others can only be paired with one of the IPv6
 * networks due to their different nic_tag/vlan_id values. To represent where
 * these two network pools intersect, getPoolIntersections() would return the
 * following array:
 *
 * [
 *   { nic_tag: "r1internal", mtu: 1500, vlan_id: 21, vnet_id: undefined },
 *   { nic_tag: "r2internal", mtu: 1500, vlan_id: 22, vnet_id: undefined },
 *   { nic_tag: "r2internal", mtu: 1500, vlan_id: 23, vnet_id: undefined }
 * ]
 *
 * This array is then used in lib/models/nic/provision.js to help inform the IP
 * selection process, to make sure we are only considering compatible networks
 * at any given moment (see runProvisions() and NetworkPoolProvision).
 *
 * This means that we might try selecting addresses from 10.0.0.0/24 and
 * fd00::/64 for a new NIC, but never 10.0.1.0/24 and fd02::/64, since that
 * would require the NIC to be on two different VLANs at once.
 */

'use strict';

var assert = require('assert-plus');
var constants = require('./constants');
var errors = require('./errors');
var jsprim = require('jsprim');
var util = require('util');


// --- Exports

function getPoolIntersections(name, params, pools) {
    assert.string(name, 'name');
    assert.object(params, 'params');
    assert.array(pools, 'pools');

    var missing_nictags = !(params.nic_tag || params.nic_tags_available);

    var constraints = [];

    pools.forEach(function (pool) {
        var options = {};

        if (missing_nictags && pool.params.nic_tags_present.length > 1) {
            throw errors.missingParam('nic_tags_available',
                util.format(constants.fmt.POOL_NIC_TAGS_AMBIGUOUS, pool.uuid));
        }

        pool.networks.forEach(function (network) {
            if (params.nic_tag !== undefined &&
                params.nic_tag !== network.nic_tag) {
                return;
            }

            if (params.nic_tags_available !== undefined &&
                params.nic_tags_available.indexOf(network.nic_tag) === -1) {
                return;
            }

            if (params.mtu !== undefined && params.mtu !== network.mtu) {
                return;
            }

            if (params.vlan_id !== undefined &&
                params.vlan_id !== network.vlan_id) {
                return;
            }

            if (params.vnet_id !== undefined &&
                params.vnet_id !== network.vnet_id) {
                return;
            }

            var key =
                network.nic_tag + '/' +
                network.mtu + '/' +
                network.vlan_id + '/' +
                network.vnet_id;

            options[key] = {
                mtu: network.mtu,
                nic_tag: network.nic_tag,
                vlan_id: network.vlan_id,
                vnet_id: network.vnet_id
            };
        });

        if (jsprim.isEmpty(options)) {
            throw errors.invalidParam(name,
                util.format(constants.fmt.POOL_FAILS_CONSTRAINTS, pool.uuid));
        }

        constraints.push(options);
    });

    var result = constraints.shift();

    constraints.forEach(function (constraint) {
        var suggestions = Object.keys(result);
        suggestions.forEach(function (suggestion) {
            if (!constraint.hasOwnProperty(suggestion)) {
                delete result[suggestion];
            }
        });
    });

    if (jsprim.isEmpty(result)) {
        throw errors.invalidParam(name, constants.msg.NO_POOL_INTERSECTION);
    }

    var okay = [];
    for (var k in result) {
        okay.push(result[k]);
    }
    return okay;
}


module.exports = {
    getPoolIntersections: getPoolIntersections
};
