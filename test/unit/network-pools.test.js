/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Unit tests for nic endpoints
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var common = require('../lib/common');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_tag = require('../lib/nic-tag');
var mod_pool = require('../lib/pool');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var models = require('../../lib/models');
var repeat = require('../../lib/util/common').repeat;
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var MORAY;
var NAPI;
var NETS = [];
var POOLS = [];

var NIC_TAG1 = 'nictag1p' + process.pid;
var NIC_TAG2 = 'nictag2p' + process.pid;
var NIC_TAG3 = 'nictag3p' + process.pid;


// --- Internal helpers



function netParams(extra) {
    if (!extra) {
        extra = {};
    }

    var l = NETS.length;
    assert.ok(l < 10, 'too many networks');

    var params = {
        name: 'net' + l,
        nic_tag: NIC_TAG1,
        subnet: util.format('10.0.%d.0/28', l),
        provision_end_ip: util.format('10.0.%d.12', l),
        provision_start_ip: util.format('10.0.%d.9', l),
        // Ensure the networks sort in order of creation:
        uuid: util.format('%d%d%d%d7862-54fa-4667-89ae-c981cd5ada9a',
            l, l, l, l)
    };

    for (var e in extra) {
        params[e] = extra[e];
    }

    return h.validNetworkParams(params);
}

function v6netParams(extra) {
    if (!extra) {
        extra = {};
    }

    var l = NETS.length;
    assert.ok(l < 10, 'too many networks');

    var params = {
        name: 'net' + l,
        nic_tag: NIC_TAG1,
        // Ensure the networks sort in order of creation:
        uuid: util.format('%d%d%d%d7862-54fa-4667-89ae-c981cd5ada9a',
            l, l, l, l)
    };

    for (var e in extra) {
        params[e] = extra[e];
    }

    return h.validIPv6NetworkParams(params);
}


function createNet(t, extra) {
    if (!extra) {
        extra = {};
    }

    NAPI.createNetwork(netParams(extra), function (err, res) {
        if (h.ifErr(t, err, 'createNetwork() error')) {
            t.end();
            return;
        }

        NETS.push(res);

        t.end();
    });
}



// --- Setup



test('Initial setup', function (t) {
    h.reset();

    h.createClientAndServer(function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');

        NAPI = res;
        MORAY = moray;

        if (!NAPI) {
            return t.end();
        }

        var net1Params = netParams({
            subnet: '10.0.0.0/28',
            provision_start_ip: '10.0.0.2',
            provision_end_ip: '10.0.0.5'
        });

        t.test('delete previous', function (t2) {
            mod_pool.delAll(t2, {});
        });

        t.test('create nic tag 1', function (t2) {
            mod_tag.create(t2, { name: NIC_TAG1 });
        });

        t.test('create nic tag 2', function (t2) {
            mod_tag.create(t2, { name: NIC_TAG2 });
        });

        t.test('create nic tag 3', function (t2) {
            mod_tag.create(t2, { name: NIC_TAG3 });
        });

        t.test('create net0', function (t2) {
            NAPI.createNetwork(net1Params, function (err2, res2) {
                if (res2) {
                    NETS.push(res2);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create net1', function (t2) {
            createNet(t2);
        });

        t.test('create net2', function (t2) {
            createNet(t2);
        });

        t.test('create net3', function (t2) {
            createNet(t2, { nic_tag: NIC_TAG2 });
        });

        t.test('create net4', function (t2) {
            createNet(t2);
        });

        t.test('create net5', function (t2) {
            createNet(t2);
        });

        t.test('create net6', function (t2) {
            NAPI.createNetwork(v6netParams(), function (err2, res2) {
                if (res2) {
                    NETS.push(res2);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create net7', function (t2) {
            NAPI.createNetwork(v6netParams(), function (err2, res2) {
                if (res2) {
                    NETS.push(res2);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create net8', function (t2) {
            createNet(t2);
        });

        t.test('create pool1', function (t2) {
            var name = 'pool1-' + process.pid;
            var params = {
                description: 'This is pool 1',
                networks: [ NETS[0].uuid, NETS[1].uuid, NETS[2].uuid ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[0].nic_tag;
                    params.nic_tags_present = [ NETS[0].nic_tag ];
                    params.family = 'ipv4';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create pool2', function (t2) {
            var name = 'pool2-' + process.pid;
            var params = {
                networks: [ NETS[4].uuid, NETS[5].uuid ],
                owner_uuids: [ mod_uuid.v4() ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[4].nic_tag;
                    params.nic_tags_present = [ NETS[4].nic_tag ];
                    params.family = 'ipv4';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create pool3', function (t2) {
            var name = 'pool3-' + process.pid;
            var params = {
                networks: [ NETS[6].uuid, NETS[7].uuid ],
                owner_uuids: [ mod_uuid.v4() ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[6].nic_tag;
                    params.nic_tags_present = [ NETS[6].nic_tag ];
                    params.family = 'ipv6';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });

        t.test('create pool4', function (t2) {
            var name = 'pool4-' + process.pid;
            var params = {
                networks: [ NETS[0].uuid, NETS[1].uuid ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[0].nic_tag;
                    params.nic_tags_present = [ NETS[0].nic_tag ];
                    params.family = 'ipv4';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });


        t.test('create pool5', function (t2) {
            var name = 'pool5-' + process.pid;
            var params = {
                networks: [ NETS[3].uuid, NETS[8].uuid ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[3].nic_tag;
                    params.nic_tags_present =
                        [ NETS[3].nic_tag, NETS[8].nic_tag ];
                    params.family = 'ipv4';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });


        t.test('create pool6', function (t2) {
            var name = 'pool6-' + process.pid;
            var params = {
                networks: [ NETS[0].uuid, NETS[3].uuid ]
            };

            NAPI.createNetworkPool(name, params, function (err2, res2) {
                if (res2) {
                    POOLS.push(res2);
                    params.name = name;
                    params.uuid = res2.uuid;
                    params.nic_tag = NETS[0].nic_tag;
                    params.nic_tags_present =
                        [ NETS[0].nic_tag, NETS[3].nic_tag ];
                    params.family = 'ipv4';
                    t2.deepEqual(res2, params, 'result for ' + res2.uuid);
                }

                t2.ifErr(err2);
                t2.end();
            });
        });


        t.end();
    });
});



// --- Create tests



test('Create pool - non-existent network', function (t) {
    var params = {
        networks: [ NETS[0].uuid, mod_uuid.v4() ]
    };
    NAPI.createNetworkPool('pool-fail-1-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        var unknownParam = mod_err.invalidParam('networks', 'unknown network');
        unknownParam.invalid = [ params.networks[1] ];

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ unknownParam ]
        }), 'error body');

        return t.end();
    });
});


test('Create pool - too many networks', function (t) {
    var params = {
        networks: [ ]
    };
    for (var n = 0; n < 65; n++) {
        params.networks.push(mod_uuid.v4());
    }

    NAPI.createNetworkPool('pool-fail-1-' + process.pid, params,
        function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                'maximum 64 networks per network pool') ]
        }), 'error body');

        return t.end();
    });
});


test('Create pool - invalid params (non-objects)', function (t) {
    vasync.forEachParallel({
        inputs: h.NON_OBJECT_PARAMS,
        func: function (data, cb) {
            NAPI.post({ path: '/network_pools' }, data, function (err) {
                t.ok(err, util.format('error returned: %s',
                    JSON.stringify(data)));
                if (!err) {
                    cb();
                    return;
                }

                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, {
                    code: 'InvalidParameters',
                    message: 'Invalid parameters',
                    errors: [
                        mod_err.invalidParam('parameters',
                            constants.msg.PARAMETERS_ARE_OBJECTS)
                    ]
                }, 'Error body');

                cb();
            });
        }
    }, function () {
        return t.end();
    });
});


test('Create pool - mismatched address families', function (t) {
    mod_pool.create(t, {
        name: 'pool-fail-3-' + process.pid,
        params: {
            networks: [ NETS[0].uuid, NETS[6].uuid ]
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_AF_MATCH_MSG) ]
        })
    });
});


test('All invalid parameters', function (t) {
    NAPI.post({ path: '/network_pools' }, {
        uuid: 'foobar',
        name: true,
        networks: { '0': '258f413b-3a37-4c5b-af61-af69ef8a542e' },
        description: 2017,
        owner_uuids: { 'owner': '5edc49d0-c3df-c7c2-d475-b92facca7895' }
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('description',
                    constants.msg.STR),
                mod_err.invalidParam('name',
                    constants.msg.STR),
                mod_err.invalidParam('networks',
                    constants.msg.ARRAY_OF_STR),
                mod_err.invalidParam('owner_uuids',
                    constants.msg.ARRAY_OF_STR),
                mod_err.invalidParam('uuid',
                    constants.msg.INVALID_UUID)
            ]
        }), 'error body');

        t.end();
    });
});


test('Missing "name" parameter', function (t) {
    NAPI.post({ path: '/network_pools' }, {
        networks: [ NETS[0].uuid ]
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.missingParamErr({
            errors: [ mod_err.missingParam('name') ]
        }), 'error body');

        t.end();
    });
});


test('Missing "networks" parameter', function (t) {
    NAPI.post({ path: '/network_pools' }, {
        name: 'my-network-pool'
    }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.missingParamErr({
            errors: [ mod_err.missingParam('networks') ]
        }), 'error body');

        t.end();
    });
});




// --- Update tests



test('Update non-existent pool', function (t) {
    var params = {
        networks: [ NETS[0].uuid ]
    };

    NAPI.updateNetworkPool(mod_uuid.v4(), params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
            code: 'ResourceNotFound',
            message: 'network pool not found'
        }, 'error body');

        return t.end();
    });
});


test('Update pool', function (t) {
    var params = {
        networks: [ NETS[0].uuid, NETS[1].uuid ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        POOLS[0].networks = params.networks;
        t.deepEqual(res, POOLS[0], 'updated result');
        return t.end();
    });
});


test('Update pool 1 to a new description', function (t) {
    var descr = 'This is the new pool 1 description';
    POOLS[0].description = descr;
    mod_pool.update(t, {
        uuid: POOLS[0].uuid,
        params: {
            description: descr
        },
        exp: POOLS[0]
    });
});


test('Update pool 2 to have a description', function (t) {
    var descr = 'This is pool 2';
    POOLS[1].description = descr;
    mod_pool.update(t, {
        uuid: POOLS[1].uuid,
        params: {
            description: descr
        },
        exp: POOLS[1]
    });
});


test('Update pool 3 to a new name', function (t) {
    var name = POOLS[2].name + '-altered';
    POOLS[2].name = name;
    mod_pool.update(t, {
        uuid: POOLS[2].uuid,
        params: {
            name: name
        },
        exp: POOLS[2]
    });
});


test('Update pool: no networks', function (t) {
    var params = {
        networks: [ ]
    };

    NAPI.updateNetworkPool(POOLS[0].uuid, params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_MIN_NETS_MSG) ]
        }), 'error body');

        return t.end();
    });
});


test('Update IPv4 pool - mixed address families', function (t) {
    mod_pool.update(t, {
        uuid: POOLS[0].uuid,
        params: {
            networks: [ NETS[0].uuid, NETS[1].uuid, NETS[2].uuid, NETS[6].uuid ]
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_AF_MATCH_MSG) ]
        })
    });
});


test('Update IPv4 pool - all IPv6 networks', function (t) {
    mod_pool.update(t, {
        uuid: POOLS[0].uuid,
        params: {
            networks: [ NETS[6].uuid, NETS[7].uuid ]
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_AF_MATCH_MSG) ]
        })
    });
});


test('Update IPv6 pool - mixed address families', function (t) {
    mod_pool.update(t, {
        uuid: POOLS[2].uuid,
        params: {
            networks: [ NETS[0].uuid, NETS[6].uuid, NETS[7].uuid ]
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_AF_MATCH_MSG) ]
        })
    });
});


test('Update IPv6 pool - all IPv4 networks', function (t) {
    mod_pool.update(t, {
        uuid: POOLS[2].uuid,
        params: {
            networks: [ NETS[0].uuid, NETS[1].uuid ]
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                constants.POOL_AF_MATCH_MSG) ]
        })
    });
});


test('Update pool: remove owner_uuids', function (t) {
    t.plan(4);

    var params = {
        owner_uuids: [ ]
    };

    t.test('update', function (t2) {
        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'update pool')) {
                return t2.end();
            }

            delete POOLS[1].owner_uuids;
            t2.deepEqual(res, POOLS[1], 'owner_uuids removed');

            MORAY.getObject(models.network_pool.bucket().name, POOLS[1].uuid,
                function (err2, morayObj) {
                t2.ifError(err2, 'Getting pool should succeed');
                t2.ok(!morayObj.value.hasOwnProperty('owner_uuids'),
                    'owner_uuids property no longer present in moray');
                t2.end();
            });
        });
    });

    t.test('get', function (t2) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t2, err, 'get pool')) {
                return t2.end();
            }

            t2.deepEqual(res, POOLS[1], 'get result');
            return t2.end();
        });
    });

    t.test('update owner_uuids', function (t2) {
        params.owner_uuids = [ mod_uuid.v4(), mod_uuid.v4() ];

        NAPI.updateNetworkPool(POOLS[1].uuid, params, function (err, res) {
            if (h.ifErr(t2, err, 'update pool')) {
                return t2.end();
            }

            POOLS[1].owner_uuids = params.owner_uuids.sort();
            t2.deepEqual(res, POOLS[1], 'owner_uuids added');

            MORAY.getObject(models.network_pool.bucket().name, POOLS[1].uuid,
                function (err2, morayObj) {
                t2.ifError(err2, 'Getting pool should succeed');
                t2.ok(morayObj, 'got moray object');
                t2.equal(morayObj.value.owner_uuids, ','
                    + params.owner_uuids.sort().join(',') + ',',
                    'owner_uuids updated in moray');
                t2.end();
            });
        });
    });

    t.test('second get', function (t2) {
        NAPI.getNetworkPool(POOLS[1].uuid, function (err, res) {
            if (h.ifErr(t2, err, 'get pool')) {
                return t2.end();
            }

            t2.deepEqual(res, POOLS[1], 'get result');
            return t2.end();
        });
    });
});



// --- Get tests



test('Get pool', function (t) {
    NAPI.getNetworkPool(POOLS[0].uuid, function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        t.deepEqual(res, POOLS[0], 'get result');
        return t.end();
    });
});


test('provisionable_by network pools: owner', function (t) {
    t.plan(5);

    var net;
    var owners = [];
    var pool;

    t.test('create network', function (t2) {
        owners = [ mod_uuid.v4(), mod_uuid.v4() ];
        var params = netParams({
            owner_uuids: [ owners[0] ]
        });

        mod_net.create(t2, {
            params: params,
            partialExp: params
        });
    });

    t.test('create', function (t2) {
        net = mod_net.lastCreated();
        t2.ok(net, 'Have last created network');

        var params = {
            networks: [ net.uuid ],
            owner_uuids: [ owners[0] ]
        };

        mod_pool.create(t2, {
            name: '<generate>',
            params: params,
            partialExp: params
        });
    });

    t.test('list', function (t2) {
        pool = mod_pool.lastCreated();
        t2.ok(pool, 'Have last created pool');
        POOLS.push(pool);

        mod_pool.list(t2, {
            params: {
                provisionable_by: owners[0]
            },
            present: [ pool ]
        });
    });

    t.test('get: provisionable_by owner', function (t2) {
        mod_pool.get(t2, {
            uuid: pool.uuid,
            params: {
                provisionable_by: owners[0]
            },
            exp: pool
        });
    });

    t.test('get: provisionable_by other', function (t2) {
        mod_pool.get(t2, {
            uuid: pool.uuid,
            params: {
                provisionable_by: owners[1]
            },
            expCode: 403,
            expErr: {
                code: 'NotAuthorized',
                message: constants.msg.POOL_OWNER
            }
        });
    });
});



// --- List tests

test('List pools', function (t) {
    NAPI.listNetworkPools(function (err, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.end();
        }

        var sorted = clone(POOLS);
        sorted.sort(h.uuidSort);
        t.deepEqual(res.sort(h.uuidSort), sorted, 'list result');
        return t.end();
    });
});

test('List pools - filter for "ipv4" pools', function (t) {
    mod_pool.list(t, {
        params: {
            family: 'ipv4'
        },
        deepEqual: true,
        present: [
            POOLS[0],
            POOLS[1],
            POOLS[3],
            POOLS[4],
            POOLS[5],
            POOLS[6]
        ]
    });
});

test('List pools - filter for "ipv6" pools', function (t) {
    mod_pool.list(t, {
        params: {
            family: 'ipv6'
        },
        deepEqual: true,
        present: [ POOLS[2] ]
    });
});

test('List pools - bad "family" filter', function (t) {
    mod_pool.list(t, {
        params: {
            family: 'unix'
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('family',
                'must be one of: "ipv4", "ipv6"') ]
        })
    });
});

test('List pools - name filter', function (t) {
    mod_pool.list(t, {
        params: {
            name: POOLS[0].name
        },
        deepEqual: true,
        present: [ POOLS[0] ]
    });
});

test('List pools - empty name filter', function (t) {
    mod_pool.list(t, {
        params: {
            name: ''
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('name', 'must not be empty') ]
        })
    });
});

test('List pools - single network filter', function (t) {
    mod_pool.list(t, {
        params: {
            networks: NETS[4].uuid
        },
        deepEqual: true,
        present: [ POOLS[1] ]
    });
});

test('List pools - filter returns multiple networks', function (t) {
    mod_pool.list(t, {
        params: {
            networks: [ POOLS[3].networks[0] ]
        },
        deepEqual: true,
        present: [
            POOLS[0],
            POOLS[3],
            POOLS[5]
        ]
    });
});

test('List pools - filter with three networks', function (t) {
    mod_pool.list(t, {
        params: {
            networks: POOLS[0].networks
        },
        expCode: 422,
        expErr: h.invalidParamErr({
            errors: [ mod_err.invalidParam('networks',
                'Only one network UUID allowed') ]
        })
    });
});

test('List Network Pool failures', function (t) {
    t.plan(common.badLimitOffTests.length);

    common.badLimitOffTests.forEach(function (blot) {
        t.test(blot.bc_name, function (t2) {
            mod_pool.list(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    });
});



// --- Provisioning tests



test('Provision nic - on IPv4 network pool with IPv4 address', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: NETS[1].provision_start_ip,
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic(POOLS[0].uuid, params, function (err, res) {
        t.ok(err);
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('ip', constants.POOL_IP_MSG) ]
        }), 'error body');

        return t.end();
    });
});


test('Provision nic - on network pool', function (t) {
    // The "Update pool" test above changes POOLS[0] to have NETS[0] and
    // NETS[1] as its networks:
    var ipNums = [
        // NETS[0]: provisionable range of 10.0.0.2 -> 10.0.0.5
        '2', '3', '4', '5',
        // NETS[1]: provisionable range of 10.0.0.9 -> 10.0.0.12
        '9', '10', '11', '12'
    ];

    repeat(function (cb) {
        var client = h.createClient();
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };
        var nextIPnum = ipNums.shift();
        var nextIP = util.format('10.0.%d.%d',
            nextIPnum < 6 ? 0 : 1,
            nextIPnum);
        var desc = util.format(' %s (req_id=%s)', nextIP, client.req_id);

        client.provisionNic(POOLS[0].uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provisioning' + desc)) {
                return cb(null, null, true);
            }

            var net = nextIPnum < 6 ? NETS[0] : NETS[1];

            delete res.created_timestamp;
            delete res.modified_timestamp;

            t.deepEqual(res, mod_nic.addDefaultParams({
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: nextIP,
                mac: res.mac,
                owner_uuid: params.owner_uuid
            }, net), 'result for' + desc);

            var keepGoing = ipNums.length !== 0;
            return cb(null, null, keepGoing);
        });
    }, function () {
        // Both networks should now be exhausted of IPs and should return
        // an error accordingly

        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t, {
            net: POOLS[0].uuid,
            params: params,
            expCode: 422,
            expErr: h.invalidParamErr({
                errors: [ mod_err.invalidParam('network_uuid',
                    util.format(constants.fmt.POOL_FULL_MSG, POOLS[0].uuid)) ]
            })
        });
    });
});



test('Provision NIC on pool: Retry after QueryTimeoutErrors', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: constants.UFDS_ADMIN_UUID
    };

    var fakeErr = new Error('Timed out');
    fakeErr.name = 'QueryTimeoutError';

    /*
     * The sql() error will prevent NAPI from selecting an IP from
     * the network. It will then retry, and fail to submit with
     * batch(). After these errors, it will still use the originally
     * selected IP, since it didn't actually need to change.
     */
    MORAY.setMockErrors({
        sql: [ fakeErr ],
        batch: [ fakeErr, fakeErr, fakeErr ]
    });

    t.test('NIC provision', function (t2) {
        mod_nic.provision(t2, {
            net: POOLS[1].uuid,
            params: params,
            exp: mod_nic.addDefaultParams({
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                owner_uuid: params.owner_uuid,
                ip: h.nextProvisionableIP(NETS[4])
            }, NETS[4])
        });
    });

    t.test('Confirm that NAPI hit the errors', function (t2) {
        // Make sure we actually hit all of the errors:
        t2.deepEqual(MORAY.getMockErrors(), {
            sql: [ ],
            batch: [ ]
        }, 'no more batch errors left');
        t2.end();
    });
});


test('Provision NIC on pool: pool has multiple NIC tags', function (t) {
    t.test('Provision with "nic_tags_available"', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4(),
            nic_tags_available: [ NIC_TAG1, NIC_TAG3 ]
        };

        mod_nic.provision(t2, {
            net: POOLS[4].uuid,
            params: params,
            partialExp: mod_net.addNetParams(NETS[8], {
                belongs_to_type: 'zone',
                belongs_to_uuid: params.belongs_to_uuid,
                owner_uuid: params.owner_uuid,
                ip: h.nextProvisionableIP(NETS[8])
            })
        });
    });

    t.test('Provision with "nic_tags_available"', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4(),
            nic_tags_available: [ NIC_TAG2, NIC_TAG3 ]
        };

        mod_nic.provision(t2, {
            net: POOLS[4].uuid,
            params: params,
            partialExp: mod_net.addNetParams(NETS[3], {
                belongs_to_type: 'zone',
                belongs_to_uuid: params.belongs_to_uuid,
                owner_uuid: params.owner_uuid,
                ip: h.nextProvisionableIP(NETS[3])
            })
        });
    });

    t.test('Provision with "nic_tag"', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4(),
            nic_tag: NIC_TAG2
        };

        mod_nic.provision(t2, {
            net: POOLS[4].uuid,
            params: params,
            partialExp: mod_net.addNetParams(NETS[3], {
                belongs_to_type: 'zone',
                belongs_to_uuid: params.belongs_to_uuid,
                owner_uuid: params.owner_uuid,
                ip: h.nextProvisionableIP(NETS[3])
            })
        });
    });

    t.test('Provision with no nic_tag hints', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t2, {
            net: POOLS[4].uuid,
            params: params,
            expCode: 422,
            expErr: h.missingParamErr({
                errors: [ h.missingParam('nic_tags_available',
                    util.format(constants.fmt.POOL_NIC_TAGS_AMBIGUOUS,
                        POOLS[4].uuid)) ]
            })
        });
    });

    t.test('Provision with no matching networks in pool', function (t2) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4(),
            nic_tags_available: [ NIC_TAG3 ]
        };

        mod_nic.provision(t2, {
            net: POOLS[4].uuid,
            params: params,
            expCode: 422,
            expErr: h.invalidParamErr({
                errors: [ mod_err.invalidParam('network_uuid',
                    util.format(constants.fmt.POOL_FAILS_CONSTRAINTS,
                        POOLS[4].uuid)) ]
            })
        });
    });
});


test('Provision NIC on pool: First intersection fails', function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4(),
        nic_tags_available: POOLS[5].nic_tags_present
    };

    /*
     * NETS[0] was exhausted earlier, so provisioning on it will fail, and
     * we'll end up provisioning onto NETS[3] instead.
     */
    mod_nic.provision(t, {
        net: POOLS[5].uuid,
        params: params,
        partialExp: mod_net.addNetParams(NETS[3], {
            belongs_to_type: 'zone',
            belongs_to_uuid: params.belongs_to_uuid,
            owner_uuid: params.owner_uuid,
            ip: h.nextProvisionableIP(NETS[3])
        })
    });
});



// --- Delete tests



test('Delete network in IPv4 pool', function (t) {
    mod_net.del(t, {
        uuid: NETS[4].uuid,
        expCode: 422,
        expErr: {
            code: 'InUse',
            message: 'Network is in use',
            errors: [ mod_err.usedBy('network pool', POOLS[1].uuid) ]
        }
    });
});


test('Delete network in IPv6 pool', function (t) {
    mod_net.del(t, {
        uuid: NETS[6].uuid,
        expCode: 422,
        expErr: {
            code: 'InUse',
            message: 'Network is in use',
            errors: [ mod_err.usedBy('network pool', POOLS[2].uuid) ]
        }
    });
});



// --- Teardown

test('delete nics', mod_nic.delAllCreated);

test('Stop server', mod_server.close);
