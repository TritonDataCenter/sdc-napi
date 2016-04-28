/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for /networks endpoints
 */

'use strict';

var constants = require('../../lib/util/constants');
var extend = require('xtend');
var fmt = require('util').format;
var h = require('./helpers');
var mod_net = require('../lib/net');
var mod_uuid = require('node-uuid');
var mod_vasync = require('vasync');
var test = require('tape');
var util = require('util');



// --- Globals



var napi = h.createNAPIclient();
var OWNERS = [
    mod_uuid.v4()
];
var NETS = [
    h.validNetworkParams({
        owner_uuids: [ OWNERS[0] ]
    })
];
var state = { };
var ufdsAdminUuid;  // Loaded in setup below



// --- Setup



test('load UFDS admin UUID', function (t) {
    h.loadUFDSadminUUID(t, function (adminUUID) {
        if (adminUUID) {
            ufdsAdminUuid = adminUUID;
        }

        return t.end();
    });
});


test('create test nic tag', function (t) {
    h.createNicTag(t, napi, state);
});


test('create second test nic tag', function (t) {
    h.createNicTag(t, napi, state, 'nicTag2');
});


test('delete previously created networks', function (t) {
    h.deletePreviousNetworks(t);
});



// --- Tests



test('POST /networks (invalid nic tag)', function (t) {
    var params = {
        name: 'networks-integration-' + process.pid + '-invalid',
        vlan_id: 2,
        subnet: '10.77.77.0/24',
        provision_start_ip: '10.77.77.5',
        provision_end_ip: '10.77.77.250',
        nic_tag: 'invalid_tag',
        gateway: '10.77.77.1',
        resolvers: ['1.2.3.4', '10.77.77.2']
    };

    napi.createNetwork(params, function (err, res) {
        t.ok(err, 'error creating network');
        if (!err) {
            return t.end();
        }

        t.deepEqual(err.body, {
            code: 'InvalidParameters',
            message: 'Invalid parameters',
            errors: [
                {
                    code: 'InvalidParameter',
                    field: 'nic_tag',
                    message: 'nic tag does not exist'
                }
            ]
        }, 'Error is correct');

        return t.end();
    });
});


test('POST /networks', function (t) {
    var params = {
        name: 'networks-integration-' + process.pid,
        vlan_id: 0,
        // "TEST-NET-1" in RFC 5737:
        subnet: '192.0.2.0/24',
        provision_start_ip: '192.0.2.5',
        provision_end_ip: '192.0.2.250',
        nic_tag: state.nicTag.name,
        gateway: '192.0.2.1',
        resolvers: ['1.2.3.4', '192.0.2.2']
    };

    napi.createNetwork(params, function (err, res) {
        if (h.ifErr(t, err, 'create network')) {
            return t.end();
        }

        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        state.network = res;
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        return t.end();
    });
});


test('Create network on second nic tag', function (t) {
    var params = {
        nic_tag: state.nicTag2.name
    };
    h.createNetwork(t, napi, state, params, 'network2');
});


test('validate IPs created with network', function (t) {
    var ips = [ '192.0.2.1', '192.0.2.2'].reduce(function (arr, i) {
            arr.push({
                ip: i,
                belongs_to_uuid: ufdsAdminUuid,
                belongs_to_type: 'other',
                network_uuid: state.network.uuid,
                owner_uuid: ufdsAdminUuid,
                reserved: true,
                free: false
            });
            return arr;
        }, []);

    function checkIP(params, cb) {
        napi.getIP(state.network.uuid, params.ip, function (err, res) {
            t.ifError(err, 'get IP: ' + params.ip);
            if (err) {
                return cb(err);
            }
            t.deepEqual(res, params, 'params for IP ' + params.ip);
            return cb();
        });
    }

    mod_vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        t.ifError(err, 'getting all IPs should succeed');
        t.end();
    });
});


test('GET /networks/:uuid', function (t) {
    napi.getNetwork(state.network.uuid, function (err, res) {
        t.ifError(err, 'get network: ' + state.network.uuid);
        if (err) {
            return t.end();
        }

        t.deepEqual(res, state.network, 'network params correct');
        return t.end();
    });
});


test('GET /networks/admin', function (t) {
    napi.getNetwork('admin', function (err, res) {
        t.ifError(err, 'get admin network');
        if (err) {
            return t.end();
        }

        t.equal(res.name, 'admin', 'admin network found');
        return t.end();
    });
});


test('GET /networks', function (t) {

    t.test('list all networks', function (t2) {
        mod_net.list(t2, {
            present: [ state.network, state.network2 ]
        });
    });


    t.test('list networks: OR name', function (t2) {
        mod_net.list(t2, {
            params: {
                name: [ state.network.name, state.network2.name ]
            },
            deepEqual: true,
            present: [ state.network, state.network2 ]
        });
    });


    t.test('create network with different owner', function (t2) {
        mod_net.create(t2, {
            fillInMissing: true,
            params: NETS[0],
            exp: NETS[0]
        });
    });


    t.test('list all networks: provisionable_by', function (t2) {
        mod_net.list(t2, {
            params: {
                provisionable_by: OWNERS[0]
            },
            present: [ state.network, state.network2 ]
        });
    });

});


test('GET /networks (filtered)', function (t) {
    var filter = {
        name: state.network.name
    };
    var desc = util.format(' (name=%s)', filter.name);

    napi.listNetworks(filter, function (err, res) {
        t.ifError(err, 'get networks' + desc);
        t.ok(res, 'list returned' + desc);
        if (err || !res) {
            return t.end();
        }

        t.equal(res.length, 1, 'only matches one network' + desc);
        t.deepEqual(res[0], state.network, 'network params match' + desc);
        return t.end();
    });
});


test('GET /networks (filter: multiple nic tags)', function (t) {

    t.test('multiple nic tags: array', function (t2) {
        mod_net.list(t2, {
            params: {
                nic_tag: [ state.nicTag.name, state.nicTag2.name ]
            },
            deepEqual: true,
            present: [ state.network, state.network2, NETS[0] ]
        });
    });


    t.test('multiple nic tags: comma-separated', function (t2) {
        mod_net.list(t2, {
            params: {
                nic_tag: state.nicTag.name + ',' + state.nicTag2.name
            },
            deepEqual: true,
            present: [ state.network, state.network2, NETS[0] ]
        });
    });

});


test('POST /networks (empty gateway)', function (t) {
    var params = h.validNetworkParams({ gateway: '' });

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            return t.end();
        }

        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        params.resolvers = [];
        delete params.gateway;

        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
        state.network3 = res;

        return t.end();
    });
});


test('POST /networks (single resolver)', function (t) {
    var params = h.validNetworkParams({ resolvers: ['8.8.4.4'] });

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            return t.end();
        }

        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.uuid = res.uuid;
        state.singleResolver = res;

        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        napi.getNetwork(res.uuid, function (err2, res2) {
            t.ifError(err2, 'create network');
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
            return t.end();
        });
    });
});


test('POST /networks (comma-separated resolvers)', function (t) {
    var params = h.validNetworkParams();
    params.resolvers = fmt('8.8.4.4,%s1', h.lastNetPrefix);

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            return t.end();
        }

        params.mtu = constants.MTU_DEFAULT;
        params.netmask = '255.255.255.0';
        params.resolvers = params.resolvers.split(',');
        params.uuid = res.uuid;

        state.commaResolvers = res;
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

        napi.getNetwork(res.uuid, function (err2, res2) {
            t.ifError(err2, 'create network');
            if (err2) {
                return t.end();
            }

            t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
            return t.end();
        });
    });
});


test('network update: resolvers and name', function (tt) {

    var params = h.validNetworkParams({ resolvers: ['8.8.4.4'] });
    var updateParams = {
        name: mod_net.name(),
        resolvers: ['1.2.3.4', '8.8.8.8']
    };

    tt.test('create network', function (t) {
        mod_net.create(t, {
            fillInMissing: true,
            params: params,
            exp: params
        });
    });


    tt.test('update network', function (t) {
        params = extend(params, updateParams);
        updateParams.uuid = params.uuid;

        mod_net.update(t, {
            params: updateParams,
            exp: params
        });
    });


    tt.test('get network', function (t) {
        mod_net.get(t, {
            params: {
                uuid: params.uuid
            },
            exp: params
        });
    });

});



// --- Teardown



test('teardown', function (t) {

    t.test('DELETE /networks/:uuid', function (t2) {
        var names = ['network', 'network2', 'network3', 'singleResolver',
            'commaResolvers'];

        function deleteNet(n, cb) {
            if (!state.hasOwnProperty(n)) {
                return cb();
            }
            napi.deleteNetwork(state[n].uuid, { force: true }, function (err) {
                t2.ifError(err, 'delete network ' + n);
                return cb();
            });
        }

        mod_vasync.forEachParallel({
            func: deleteNet,
            inputs: names
        }, function () {
            return t2.end();
        });
    });


    t.test('delete created networks', mod_net.delAllCreated);


    t.test('remove test nic tag', function (t2) {
        h.deleteNicTag(t2, napi, state);
    });


    t.test('remove second test nic tag', function (t2) {
        h.deleteNicTag(t2, napi, state, 'nicTag2');
    });

});
