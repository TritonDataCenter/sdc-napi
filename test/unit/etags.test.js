/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * Unit tests for "etag" headers.
 *
 * We test manipulating the different kinds of NAPI objects and making sure that
 * they all return the latest "etag" header, and honor "If-Match" headers.
 *
 * For each NAPI object, we do the following operations:
 *
 *   - Create the object, and ensure the returned etag matches a successive GET
 *   - Get the object with a bad etag, which should produce a 412
 *   - Update the object with a bad etag, which should produce a 412
 *   - Verify that the object is unchanged, and the etag is the same
 *   - Update with the correct, current etag, which should return a new etag
 *   - Verify that the object is changed, and the etag matches the update result
 *   - Delete with a bad etag, which should produce a 412
 *   - Verify that the object is unchanged, and the etag is the same
 *   - Delete with the correct, current etag
 *   - Verify that the object is gone
 */

'use strict';

var fmt = require('util').format;
var h = require('./helpers');
var mod_aggr = require('../lib/aggr');
var mod_ip = require('../lib/ip');
var mod_jsprim = require('jsprim');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_nicTag = require('../lib/nic-tag');
var mod_pool = require('../lib/pool');
var mod_server = require('../lib/server');
var mod_uuid = require('node-uuid');
var mod_vlan = require('../lib/vlan');
var test = require('tape');


// --- Globals

var INCORRECT = 'not the correct etag';
var OWNER = mod_uuid.v4();
var MORAY;
var NAPI;

var AGGR;
var AGGR_ETAG;

var IP;
var IP_ETAG;

var NET;
var NET_ETAG;
var NET_NUM;
var NET_PARAMS;

var NIC;
var NIC_ETAG;

var POOL;
var POOL_ETAG;

var VLAN;
var VLAN_ETAG;

// --- Internal helpers

function verifyEtag(t, etag, type) {
    t.equal(typeof (etag), 'string',
        fmt('received %s etag "%s"', type, etag));
    t.notEqual(etag, 'null',
        fmt('%s etag is not the string "null"', type));
}

function verifyUpdate(t, etag1, etag2, type) {
    t.notEqual(etag1, etag2,
        fmt('%s etag should change after update', type));
}

function precondError(etag) {
    return {
        code: 'PreconditionFailed',
        message: fmt('if-match \'%s\' didn\'t match etag \'%s\'',
            INCORRECT, etag)
    };
}

function checkEtag(t, etag) {
    return function (err, _, req, res) {
        if (h.ifErr(t, err, 'getNetwork() error')) {
            t.end();
            return;
        }

        t.deepEqual(res.headers['etag'], etag,
            'etags should match');
        t.end();
    };
}

function checkIP(t) {
    mod_ip.get(t, {
        net: NET.uuid,
        ip: IP.ip,
        exp: IP
    }, checkEtag(t, IP_ETAG));
}


function checkNetwork(t) {
    mod_net.get(t, {
        params: {
            uuid: NET.uuid
        },
        exp: NET
    }, checkEtag(t, NET_ETAG));
}


function checkPool(t) {
    mod_pool.get(t, {
        uuid: POOL.uuid,
        exp: POOL
    }, checkEtag(t, POOL_ETAG));
}


function checkNic(t) {
    mod_nic.get(t, {
        mac: NIC.mac,
        ignore: [ 'modified_timestamp' ],
        exp: NIC
    }, checkEtag(t, NIC_ETAG));
}


function checkAggr(t) {
    mod_aggr.get(t, {
        id: AGGR.id,
        exp: AGGR
    }, checkEtag(t, AGGR_ETAG));
}


function checkVLAN(t) {
    mod_vlan.get(t, {
        params: {
            vlan_id: VLAN.vlan_id,
            owner_uuid: OWNER
        },
        exp: VLAN
    }, checkEtag(t, VLAN_ETAG));
}


// --- Setup

test('Initial setup', function (t) {
    h.reset();

    NET_NUM = h.NET_NUM;
    NET_PARAMS = h.validNetworkParams();

    t.test('create client and server', function (t2) {
        h.createClientAndServer(function (err, res, moray) {
            NAPI = res;
            MORAY = moray;

            t2.ifError(err, 'server creation');
            t2.ok(NAPI, 'have NAPI client object');
            t2.ok(MORAY, 'have MORAY client object');
            t2.end();
        });
    });

    t.test('create nic tag', function (t2) {
        mod_nicTag.create(t2, {
            name: NET_PARAMS.nic_tag
        });
    });
});


// --- Create and update tests

test('Verify basic network routes', function (t) {
    t.test('Create network', function (t2) {
        mod_net.create(t2, {
            params: NET_PARAMS,
            partialExp: NET_PARAMS
        }, function (err, net, _, res) {
            if (h.ifErr(t2, err, 'createNetwork() error')) {
                t2.end();
                return;
            }

            NET = net;
            NET_ETAG = res.headers['etag'];

            verifyEtag(t2, NET_ETAG, 'network');
            checkNetwork(t2);
        });
    });

    t.test('Get network with incorrect etag', function (t2) {
        mod_net.get(t2, {
            params: {
                uuid: NET.uuid
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NET_ETAG)
        });
    });

    t.test('Update network with incorrect etag', function (t2) {
        mod_net.update(t2, {
            params: {
                uuid: NET.uuid,
                name: 'not-used-name'
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NET_ETAG)
        });
    });

    t.test('Verify that network is unchanged', checkNetwork);

    t.test('Update network with correct etag', function (t2) {
        var newName = 'updated-name';

        NET.name = newName;

        mod_net.update(t2, {
            params: {
                uuid: NET.uuid,
                name: newName
            },
            etag: NET_ETAG,
            exp: NET
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateNetwork() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateNetwork() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], NET_ETAG, 'network');

            NET_ETAG = res.headers['etag'];

            checkNetwork(t2);
        });
    });
});

test('Verify basic IP routes', function (t) {
    var owner = mod_uuid.v4();

    t.test('Create IP', function (t2) {
        var params = {
            belongs_to_type: 'other',
            belongs_to_uuid: owner,
            owner_uuid: owner
        };

        mod_ip.update(t2, {
            net: NET.uuid,
            ip: fmt('10.0.%d.50', NET_NUM),
            params: params,
            headers: {
                'If-Match': '""'
            },
            partialExp: params
        }, function (err, ip, _, res) {
            if (h.ifErr(t2, err, 'updateIP() error')) {
                t2.end();
                return;
            }

            IP = ip;
            IP_ETAG = res.headers['etag'];

            verifyEtag(t2, IP_ETAG, 'IP');
            checkIP(t2);
        });
    });

    t.test('Get IP with incorrect etag', function (t2) {
        mod_ip.get(t2, {
            net: NET.uuid,
            ip: IP.ip,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(IP_ETAG)
        });
    });

    t.test('Update IP with incorrect If-None-Match', function (t2) {
        mod_ip.update(t2, {
            net: NET.uuid,
            ip: IP.ip,
            params: {
                reserved: true
            },
            headers: {
                'If-Match': '""'
            },
            expCode: 412,
            expErr: {
                code: 'PreconditionFailed',
                message:
                    fmt('if-match \'""\' didn\'t match etag \'%s\'', IP_ETAG)
            }
        });
    });

    t.test('Update IP with incorrect etag', function (t2) {
        mod_ip.update(t2, {
            net: NET.uuid,
            ip: IP.ip,
            params: {
                reserved: true
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(IP_ETAG)
        });
    });

    t.test('Verify that IP is unchanged', checkIP);

    t.test('Update IP with correct etag', function (t2) {
        IP.reserved = true;

        mod_ip.update(t2, {
            net: NET.uuid,
            ip: IP.ip,
            params: {
                reserved: true
            },
            etag: IP_ETAG,
            exp: IP
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateIP() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateIP() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], IP_ETAG, 'IP');

            IP_ETAG = res.headers['etag'];

            checkIP(t2);
        });
    });
});


test('Verify basic network pool routes', function (t) {
    t.test('Create network pool', function (t2) {
        var params = {
            networks: [ NET.uuid ]
        };

        mod_pool.create(t2, {
            name: 'test-pool-name',
            params: params,
            partialExp: params
        }, function (err, pool, _, res) {
            if (h.ifErr(t2, err, 'createNetworkPool() error')) {
                t2.end();
                return;
            }

            POOL = pool;
            POOL_ETAG = res.headers['etag'];

            verifyEtag(t2, POOL_ETAG, 'network pool');
            checkPool(t2);
        });
    });

    t.test('Get network pool with incorrect etag', function (t2) {
        mod_pool.get(t2, {
            uuid: POOL.uuid,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(POOL_ETAG)
        });
    });

    t.test('Update pool with incorrect etag', function (t2) {
        mod_pool.update(t2, {
            uuid: POOL.uuid,
            params: {
                name: 'not-used-name'
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(POOL_ETAG)
        });
    });

    t.test('Verify that pool is unchanged', checkPool);

    t.test('Update pool with correct etag', function (t2) {
        var newName = 'test-pool-name-updated';

        POOL.name = newName;

        mod_pool.update(t2, {
            uuid: POOL.uuid,
            params: {
                name: newName
            },
            etag: POOL_ETAG,
            exp: POOL
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateNetworkPool() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateNetworkPool() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], POOL_ETAG, 'network pool');

            POOL_ETAG = res.headers['etag'];

            checkPool(t2);
        });
    });
});


test('Verify basic VLAN routes', function (t) {
    t.test('Create VLAN', function (t2) {
        var params = {
            vlan_id: 2,
            owner_uuid: OWNER
        };

        mod_vlan.create(t2, {
            params: params,
            partialExp: params
        }, function (err, vlan, _, res) {
            if (h.ifErr(t2, err, 'createFabricVLAN() error')) {
                t2.end();
                return;
            }

            VLAN = vlan;
            VLAN_ETAG = res.headers['etag'];

            verifyEtag(t2, VLAN_ETAG, 'fabric VLAN');
            checkVLAN(t2);
        });
    });

    t.test('Get VLAN with incorrect etag', function (t2) {
        mod_vlan.get(t2, {
            params: VLAN,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(VLAN_ETAG)
        });
    });

    t.test('Update VLAN with incorrect etag', function (t2) {
        mod_vlan.update(t2, {
            params: VLAN,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(VLAN_ETAG)
        });
    });

    t.test('Verify that VLAN is unchanged', checkVLAN);

    t.test('Update VLAN with correct etag', function (t2) {
        var newName = 'test-pool-name-updated';

        VLAN.name = newName;

        mod_vlan.update(t2, {
            params: VLAN,
            etag: VLAN_ETAG,
            exp: VLAN
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateFabricVLAN() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateFabricVLAN() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], VLAN_ETAG, 'fabric VLAN');

            VLAN_ETAG = res.headers['etag'];

            checkVLAN(t2);
        });
    });
});


test('Verify basic NIC routes', function (t) {
    var mac = '0a:0b:0c:0d:0e:0f';
    var belongs_to_uuid = mod_uuid.v4();
    var owner_uuid = mod_uuid.v4();

    t.test('Provision NIC', function (t2) {
        var params = {
            belongs_to_type: 'server',
            belongs_to_uuid: belongs_to_uuid,
            owner_uuid: owner_uuid
        };

        mod_nic.create(t2, {
            mac: mac,
            params: params,
            partialExp: params
        }, function (err, nic, _, res) {
            if (h.ifErr(t2, err, 'createNic() error')) {
                t2.end();
                return;
            }

            NIC = nic;
            NIC_ETAG = res.headers['etag'];

            verifyEtag(t2, NIC_ETAG, 'NIC');
            checkNic(t2);
        });
    });

    t.test('Get NIC with incorrect etag', function (t2) {
        mod_nic.get(t2, {
            mac: NIC.mac,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NIC_ETAG)
        });
    });

    t.test('Update NIC with incorrect etag', function (t2) {
        mod_nic.update(t2, {
            mac: NIC.mac,
            params: {
                allow_ip_spoofing: true
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NIC_ETAG)
        });
    });

    t.test('Verify that NIC is unchanged', checkNic);

    t.test('Update NIC with correct etag', function (t2) {
        NIC.allow_ip_spoofing = true;

        mod_nic.update(t2, {
            mac: NIC.mac,
            params: {
                allow_ip_spoofing: true
            },
            etag: NIC_ETAG,
            ignore: [ 'modified_timestamp' ],
            exp: NIC
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateNic() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateNic() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], NIC_ETAG, 'NIC');

            NIC_ETAG = res.headers['etag'];

            checkNic(t2);
        });
    });

});


test('Verify aggregation routes', function (t) {
    t.test('Create aggregation', function (t2) {
        var params = {
            macs: [ NIC.mac ],
            name: 'aggr0',
            lacp_mode: 'off'
        };

        mod_aggr.create(t2, {
            params: params,
            partialExp: params
        }, function (err, aggr, _, res) {
            if (h.ifErr(t2, err, 'createAggr() error')) {
                t2.end();
                return;
            }

            AGGR = aggr;
            AGGR_ETAG = res.headers['etag'];

            verifyEtag(t2, AGGR_ETAG, 'aggregation');
            checkAggr(t2);
        });
    });

    t.test('Get aggregation with incorrect etag', function (t2) {
        mod_aggr.get(t2, {
            id: AGGR.id,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(AGGR_ETAG)
        });
    });

    t.test('Update aggregation with incorrect etag', function (t2) {
        mod_aggr.update(t2, {
            id: AGGR.id,
            params: {
                lacp_mode: 'passive'
            },
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(AGGR_ETAG)
        });
    });

    t.test('Verify that aggregation is unchanged', checkAggr);

    t.test('Update aggregation with correct etag', function (t2) {
        AGGR.lacp_mode = 'passive';

        mod_aggr.update(t2, {
            id: AGGR.id,
            params: {
                lacp_mode: 'passive'
            },
            etag: AGGR_ETAG,
            exp: AGGR
        }, function (err, _, req, res) {
            if (h.ifErr(t2, err, 'updateAggr() error')) {
                t2.end();
                return;
            }

            if (!mod_jsprim.hasKey(res.headers, 'etag')) {
                t2.fail('updateAggr() response is missing an "etag"');
                t2.end();
                return;
            }

            verifyUpdate(t2, res.headers['etag'], AGGR_ETAG, 'aggregation');

            AGGR_ETAG = res.headers['etag'];

            checkAggr(t2);
        });
    });
});


// --- Delete tests

test('Verify aggregation delete routes', function (t) {
    t.test('Delete aggregation with incorrect etag', function (t2) {
        mod_aggr.del(t2, {
            id: AGGR.id,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(AGGR_ETAG)
        });
    });

    t.test('Verify that aggregation still exists', checkAggr);

    t.test('Delete aggregation with good etag', function (t2) {
        mod_aggr.del(t2, {
            id: AGGR.id,
            etag: AGGR_ETAG
        });
    });

    t.test('Verify that aggregation is gone', function (t2) {
        mod_aggr.get(t2, {
            id: AGGR.id,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'aggregation not found'
            }
        });
    });
});

test('Verify NIC delete routes', function (t) {
    t.test('Delete NIC with incorrect etag', function (t2) {
        mod_nic.del(t2, {
            mac: NIC.mac,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NIC_ETAG)
        });
    });

    t.test('Verify that NIC still exists', checkNic);

    t.test('Delete NIC with good etag', function (t2) {
        mod_nic.del(t2, {
            mac: NIC.mac,
            etag: NIC_ETAG
        });
    });

    t.test('Verify that NIC is gone', function (t2) {
        mod_nic.get(t2, {
            mac: NIC.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    });
});


test('Verify network pool delete routes', function (t) {
    t.test('Delete pool with incorrect etag', function (t2) {
        mod_pool.del(t2, {
            uuid: POOL.uuid,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(POOL_ETAG)
        });
    });

    t.test('Verify that pool still exists', checkNetwork);

    t.test('Delete pool with good etag', function (t2) {
        mod_pool.del(t2, {
            uuid: POOL.uuid,
            etag: POOL_ETAG
        });
    });

    t.test('Verify that pool is gone', function (t2) {
        mod_pool.get(t2, {
            uuid: POOL.uuid,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'network pool not found'
            }
        });
    });
});




test('Verify network delete routes', function (t) {
    t.test('Delete network with incorrect etag', function (t2) {
        mod_net.del(t2, {
            uuid: NET.uuid,
            etag: INCORRECT,
            expCode: 412,
            expErr: precondError(NET_ETAG)
        });
    });

    t.test('Verify that network still exists', checkNetwork);

    t.test('Delete network with good etag', function (t2) {
        mod_net.del(t2, {
            uuid: NET.uuid,
            etag: NET_ETAG
        });
    });

    t.test('Verify that network is gone', function (t2) {
        mod_net.get(t2, {
            params: {
                uuid: NET.uuid
            },
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'network not found'
            }
        });
    });
});


// --- Teardown

test('Stop server', mod_server.close);
