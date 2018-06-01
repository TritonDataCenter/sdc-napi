/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for subnet allocation.
 */

'use strict';

var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_fabric_net = require('../lib/fabric-net');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var mod_vlan = require('../lib/vlan');
var test = require('tape');


// --- Globals

var TAG;
var VLAN = {
    name: mod_vlan.randomName(),
    owner_uuid: mod_uuid.v4(),
    vlan_id: 20
};
var VLAN_extra = {
    name: mod_vlan.randomName(),
    owner_uuid: mod_uuid.v4(),
    vlan_id: 21
};
var NAPI;


// --- Setup

test('Initial setup', function (t) {
    h.reset();

    t.test('Start server', function (t2) {
        h.createClientAndServer({
            config: {
                autoAllocSubnets: true
            }
        }, function (err, res) {
            t2.ifError(err, 'server creation');
            t2.ok(res, 'client');
            NAPI = res;
            if (!NAPI) {
                t2.end();
                return;
            }

            NAPI.createNicTag('sdc_overlay', function (err2, res2) {
                TAG = res2;
                t2.ifError(err2, 'nic tag');
                t2.ok(TAG, 'created NIC tag');
                t2.end();
            });
        });
    });

    t.test('Create VLAN', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: VLAN,
            exp: VLAN
        }, function (err, res) {
            t2.ifError(err, 'vlan get');
            t2.ok(res, 'vlan');
            t2.end();
        });
    });

    t.test('Create VLAN extra', function (t2) {
        mod_vlan.createAndGet(t2, {
            params: VLAN_extra,
            exp: VLAN_extra
        }, function (err, res) {
            t2.ifError(err, 'vlan get');
            t2.ok(res, 'vlan');
            t2.end();
        });
    });


});

// Tests

// We want to test the auto-allocation code, especially edge-cases in the
// allocator --- i.e. out-of-subnets, no gap between 2 subnets, and so forth.
// Since we control all the data that goes into postgres from these unit tests,
// we can also verify that the expected subnet was allocated.


// We also want to test the behaviour related to different prefix-lengths.

// Want to test these code-paths:
// auto-alloc when we have 0 subnets, should be 10.0.0.0/24
// auto-alloc when we have >1 subnet, but no gaps
//      So, auto-alloc again, and we have: 10.1.0.0/24 (no gap)
//      Another auto-alloc should give us 10.2.0.0/24
// auto-alloc when we have >1 subnets and 1 gap
//      So, man-alloc 10.4.0.0/24
//      Another auto-alloc should give us 10.3.0.0/24
// Keep allocating subnets until we run out.
// Unit test the increment and decrement functionality (isolated from PG)
//      Ok we want to test each of the jumps between 10, 172, 192

test('Create networks', function (t) {
    t.test('Create w/ auto1', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                subnet_alloc: true,
                owner_uuid: VLAN.owner_uuid,
                family: 'ipv4',
                subnet_prefix: 24,
                name: mod_fabric_net.generateName(),
                vlan_id: VLAN.vlan_id
            },
            partialExp: {
                vlan_id: VLAN.vlan_id,
                family: 'ipv4',
                subnet: '10.0.0.0/24'
            }
        }, function (_, res) {
            t2.end();
        });
    });
    t.test('Create w/ auto2', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                subnet_alloc: true,
                family: 'ipv4',
                owner_uuid: VLAN.owner_uuid,
                subnet_prefix: 24,
                name: mod_fabric_net.generateName(),
                vlan_id: VLAN.vlan_id
            },
            partialExp: {
                vlan_id: VLAN.vlan_id,
                family: 'ipv4',
                subnet: '10.0.1.0/24'
            }
        }, function (_, res) {
            t2.end();
        });
    });
    t.test('Create w/ manual', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                subnet: '10.0.3.0/24',
                provision_start_ip: '10.0.3.1',
                provision_end_ip: '10.0.3.254',
                name: mod_fabric_net.generateName(),
                owner_uuid: VLAN.owner_uuid,
                vlan_id: VLAN.vlan_id
            },
            partialExp: {
                vlan_id: VLAN.vlan_id,
                family: 'ipv4',
                subnet: '10.0.3.0/24'
            }
        }, function (_, res) {
            t2.end();
        });
    });
    t.test('Create w/ manual missing/mixed params', function (t2) {
        var errs = [];
        errs.push(new mod_err.missingParam('provision_start_ip'));
        errs.push(new mod_err.invalidParam('subnet_prefix',
            'Auto allocation parameter not allowed'));
        mod_err.sortErrsByField(errs);
        var errBody = {
            code: 'InvalidParameters',
            errors: errs,
            message: 'Invalid parameters'
        };
        mod_fabric_net.create(t2, {
            fillInMissing: false,
            params: {
                subnet: '10.0.3.0/24',
                subnet_prefix: 24,
                provision_end_ip: '10.0.3.254',
                name: mod_fabric_net.generateName(),
                owner_uuid: VLAN.owner_uuid,
                vlan_id: VLAN.vlan_id
            },
            expCode: 422,
            expErr: errBody
        }, function (_, res) {
            t2.end();
        });
    });
    t.test('Create w/ auto3', function (t2) {
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                subnet_alloc: true,
                family: 'ipv4',
                owner_uuid: VLAN.owner_uuid,
                subnet_prefix: 24,
                name: mod_fabric_net.generateName(),
                vlan_id: VLAN.vlan_id
            },
            partialExp: {
                vlan_id: VLAN.vlan_id,
                family: 'ipv4',
                subnet: '10.0.2.0/24'
            }
        }, function (_, res) {
            t2.end();
        });
    });

    t.test('Create w/ auto4 missing/mixed params', function (t2) {
        var errs = [];
        errs.push(new mod_err.missingParam('family'));
        errs.push(new mod_err.missingParam('subnet_prefix'));
        errs.push(new mod_err.invalidParam('subnet',
            'Manual allocation parameter not allowed'));
        mod_err.sortErrsByField(errs);
        var errBody = {
            code: 'InvalidParameters',
            errors: errs,
            message: 'Invalid parameters'
        };
        mod_fabric_net.create(t2, {
            fillInMissing: true,
            params: {
                subnet_alloc: true,
                subnet: '10.0.0.0/8',
                owner_uuid: VLAN.owner_uuid,
                name: mod_fabric_net.generateName(),
                vlan_id: VLAN.vlan_id
            },
            expCode: 422,
            expErr: errBody
        });
    });


    t.test('Delete Networks', function (t2) {
        mod_fabric_net.delAllCreated(t2);
    });


    // We create 3 subnets, that consume all available addresses:
    // 10.0.0.0/8, 172.16.0.0/16, 192.168.0.0/24
    // When we try to auto-alloc we should get an exhausted-subnets error
    t.test('Exhaustion and Owner Test', function (t2) {
        t2.test('Create sub 1/3', function (t3) {
            mod_fabric_net.create(t3, {
                fillInMissing: true,
                params: {
                    subnet: '10.0.0.0/8',
                    provision_start_ip: '10.0.0.1',
                    provision_end_ip: '10.255.255.254',
                    owner_uuid: VLAN.owner_uuid,
                    name: mod_fabric_net.generateName(),
                    vlan_id: VLAN.vlan_id
                },
                partialExp: {
                    vlan_id: VLAN.vlan_id,
                    family: 'ipv4'
                }
            }, function (_, res) {
                t3.end();
            });
        });
        t2.test('Create sub 2/3', function (t3) {
            mod_fabric_net.create(t3, {
                fillInMissing: true,
                params: {
                    subnet: '172.16.0.0/12',
                    provision_start_ip: '172.16.0.1',
                    provision_end_ip: '172.31.255.254',
                    owner_uuid: VLAN.owner_uuid,
                    name: mod_fabric_net.generateName(),
                    vlan_id: VLAN.vlan_id
                },
                partialExp: {
                    vlan_id: VLAN.vlan_id,
                    family: 'ipv4'
                }
            }, function (_, res) {
                t3.end();
            });
        });
        t2.test('Create sub 3/3', function (t3) {
            mod_fabric_net.create(t3, {
                fillInMissing: true,
                params: {
                    subnet: '192.168.0.0/16',
                    provision_start_ip: '192.168.0.1',
                    provision_end_ip: '192.168.255.254',
                    owner_uuid: VLAN.owner_uuid,
                    name: mod_fabric_net.generateName(),
                    vlan_id: VLAN.vlan_id
                },
                partialExp: {
                    vlan_id: VLAN.vlan_id,
                    family: 'ipv4'
                }
            }, function (_, res) {
                t3.end();
            });
        });
        var err = new mod_err.SubnetsExhaustedError();
        var errBody = err.body;
        t2.test('Attempt Auto Alloc', function (t3) {
            mod_fabric_net.create(t3, {
                fillInMissing: true,
                params: {
                    subnet_alloc: true,
                    family: 'ipv4',
                    owner_uuid: VLAN.owner_uuid,
                    subnet_prefix: 24,
                    name: mod_fabric_net.generateName(),
                    vlan_id: VLAN.vlan_id
                },
                expCode: 507,
                expErr: errBody
            }, function () {
                t3.end();
            });
        });
        t2.test('Auto Alloc Diff Owner', function (t3) {
            mod_fabric_net.create(t3, {
                fillInMissing: true,
                params: {
                    subnet_alloc: true,
                    family: 'ipv4',
                    owner_uuid: VLAN_extra.owner_uuid,
                    subnet_prefix: 24,
                    name: mod_fabric_net.generateName(),
                    vlan_id: VLAN_extra.vlan_id
                },
                partialExp: {
                    vlan_id: VLAN_extra.vlan_id,
                    family: 'ipv4'
                }
            }, function (_, res) {
                t3.equal(res.subnet, '10.0.0.0/24');
                t3.end();
            });
        });
    });

});

// --- Teardown

test('delete networks', function (t) {
    t.test('inner delete networks', mod_fabric_net.delAllCreated);
});

test('Stop server', mod_server.close);
