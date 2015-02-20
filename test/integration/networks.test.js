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

var fmt = require('util').format;
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var test = require('tape');
var util = require('util');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
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

        params.uuid = res.uuid;
        params.netmask = '255.255.255.0';
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

    vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        return t.end();
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
    napi.listNetworks(function (err, res) {
        t.ifError(err, 'get networks');
        if (err) {
            return t.end();
        }

        t.ok(res.length > 0, 'have networks in list');

        var found = false;

        for (var n in res) {
            if (res[n].uuid == state.network.uuid) {
                found = true;
                t.deepEqual(res[n], state.network, 'network params in list');
                break;
            }
        }

        t.ok(found, 'found the test network');
        return t.end();
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
    var filters = [
        { nic_tag: [ state.nicTag.name, state.nicTag2.name ] },
        { nic_tag: state.nicTag.name + ',' + state.nicTag2.name }
    ];

    function filterList(filter, cb) {
        var desc = util.format(' (nic_tag=%j)', filter.nic_tag);

        napi.listNetworks(filter, function (err, res) {
            t.ifError(err, 'get networks' + desc);
            t.ok(res, 'list returned' + desc);
            if (err || !res) {
                return t.end();
            }

            var found = 0;
            t.equal(res.length, 2, 'matches two networks' + desc);
            for (var n in res) {
                if (res[n].uuid == state.network.uuid) {
                    found++;
                    t.deepEqual(res[n], state.network,
                        'network params in list');
                    continue;
                }

                if (res[n].uuid == state.network2.uuid) {
                    found++;
                    t.deepEqual(res[n], state.network2,
                        'network2 params in list');
                    continue;
                }
            }

            t.equal(found, 2, 'both networks found');
            return cb();
        });
    }

    vasync.forEachParallel({
        func: filterList,
        inputs: filters
    }, function (err) {
        t.end();
    });

});


test('POST /networks (empty gateway)', function (t) {
    var params = h.validNetworkParams({ gateway: '' });

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            return t.end();
        }

        params.uuid = res.uuid;
        params.netmask = '255.255.255.0';
        delete params.gateway;
        params.resolvers = [];
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

        params.uuid = res.uuid;
        params.netmask = '255.255.255.0';
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

        params.uuid = res.uuid;
        params.netmask = '255.255.255.0';
        params.resolvers = params.resolvers.split(',');
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


test('Create network - overlapping subnet ranges', function (t) {
    var created = [];
    var net = h.validNetworkParams({
        name: 'overlap-testing',
        subnet: '10.2.1.64/26',
        provision_start_ip: '10.2.1.74',
        provision_end_ip: '10.2.1.120'
    });

    var overlappingNets = [
        // encloses it
        h.validNetworkParams({
            name: 'overlapping: encloses',
            subnet: '10.2.0.0/23',
            provision_start_ip: '10.2.0.10',
            provision_end_ip: '10.2.0.20'
        }),

        // overlaps at the bottom
        h.validNetworkParams({
            name: 'overlapping: bottom',
            subnet: '10.2.1.64/27',
            provision_start_ip: '10.2.1.66',
            provision_end_ip: '10.2.1.90'
        }),

        // in the middle
        h.validNetworkParams({
            name: 'overlapping: middle',
            subnet: '10.2.1.80/28',
            provision_start_ip: '10.2.1.82',
            provision_end_ip: '10.2.1.93'
        }),

        // overlaps at the top
        h.validNetworkParams({
            name: 'overlapping: middle',
            subnet: '10.2.1.112/28',
            provision_start_ip: '10.2.1.113',
            provision_end_ip: '10.2.1.124'
        })
    ];

    t.test('create network', function (t2) {
        mod_net.create(t2, {
            params: net,
            partialExp: net
        });
    });

    t.test('create overlapping networks', function (t2) {
        net.uuid = mod_net.lastCreated().uuid;
        created.push(net);
        t.ok(net.uuid, 'original network UUID: ' + net.uuid);

        vasync.forEachPipeline({
            inputs: overlappingNets,
            func: function _createOverlapNet(oNet, cb) {
                mod_net.create(t2, {
                    continueOnErr: true,
                    desc: oNet.subnet,
                    params: oNet,
                    expErr: h.invalidParamErr({
                        errors: mod_err.networkOverlapParams([ net ])
                    })
                }, cb);
            }
        }, function () {
            return t2.end();
        });
    });

    // These "nearby" networks should all work:
    var nonOverlappingNets = [
        // just below
        h.validNetworkParams({
            name: 'just below ' + process.pid,
            subnet: '10.2.1.0/26',
            provision_start_ip: '10.2.1.10',
            provision_end_ip: '10.2.1.20'
        }),

        // just above
        h.validNetworkParams({
            name: 'just above ' + process.pid,
            subnet: '10.2.1.128/26',
            provision_start_ip: '10.2.1.130',
            provision_end_ip: '10.2.1.140'
        })
    ];

    t.test('create non-overlapping networks', function (t2) {
        vasync.forEachPipeline({
            inputs: nonOverlappingNets,
            func: function _createOverlapNet(oNet, cb) {
                mod_net.create(t2, {
                    desc: fmt('%s (%s)', oNet.subnet, oNet.name),
                    params: oNet,
                    partialExp: oNet
                }, function (err, res) {
                    if (res) {
                        oNet.uuid = res.uuid;
                        created.push(oNet);
                    }

                    return cb();
                });
            }
        }, function () {
            return t2.end();
        });
    });

    // This network should now overlap with both the original network and
    // the one created just below it in the test above.
    t.test('create double-overlapping network', function (t2) {
        var params = h.validNetworkParams({
            name: 'double overlap ' + process.pid,
            subnet: '10.2.1.0/25',
            provision_start_ip: '10.2.1.10',
            provision_end_ip: '10.2.1.120'
        });

        mod_net.create(t2, {
            desc: params.subnet,
            params: params,
            expErr: h.invalidParamErr({
                errors: mod_err.networkOverlapParams(
                    [ net, nonOverlappingNets[0] ])
            })
        });
    });

    t.test('delete created networks', function (t2) {
        vasync.forEachPipeline({
            inputs: created,
            func: function _delCreatedNet(dNet, cb) {
                mod_net.del(t2, {
                    uuid: dNet.uuid,
                    desc: dNet.name
                }, function () {
                    return cb();
                });
            }
        }, function () {
            return t2.end();
        });
    });
});



// --- Teardown



test('DELETE /networks/:uuid', function (t) {
    var names = ['network', 'network2', 'network3', 'singleResolver',
        'commaResolvers'];

    function deleteNet(n, cb) {
        if (!state.hasOwnProperty(n)) {
            return cb();
        }
        napi.deleteNetwork(state[n].uuid, { force: true }, function (err) {
            t.ifError(err, 'delete network ' + n);
            return cb();
        });
    }

    vasync.forEachParallel({
        func: deleteNet,
        inputs: names
    }, function (err) {
        return t.end();
    });
});


test('remove test nic tag', function (t) {
    h.deleteNicTag(t, napi, state);
});


test('remove second test nic tag', function (t) {
    h.deleteNicTag(t, napi, state, 'nicTag2');
});
