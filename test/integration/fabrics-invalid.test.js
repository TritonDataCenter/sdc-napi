/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Fabric tests: invalid input
 */

'use strict';

var common = require('../lib/common');
var extend = require('xtend');
var fmt = require('util').format;
var h = require('./helpers');
var mod_err = require('../lib/err');
var mod_uuid = require('node-uuid');
var mod_fabric_net = require('../lib/fabric-net');
var mod_vasync = require('vasync');
var mod_vlan = require('../lib/vlan');
var test = require('../lib/fabrics').testIfEnabled;



// --- Globals



// 65 character string:
var LONG_STR =
    'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
var NAPI = h.createNAPIclient();
var OWNERS = [
    mod_uuid.v4(),
    mod_uuid.v4()
];
var VLANS = [
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[0],
        vlan_id: 1040
    },
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[1],
        vlan_id: 1040
    },
    {
        name: mod_vlan.randomName(),
        owner_uuid: OWNERS[1],
        vlan_id: 0
    }
];


// XXX: make test() here something that checks if overlays are enabled,
// and if not, fails and ends the test



// --- Tests


test('setup', function (tt) {

    tt.test('create vlan 0', function (t) {
        mod_vlan.createAndGet(t, {
            params: VLANS[0],
            exp: VLANS[0]
        });
    });

});


test('create invalid VLANs', function (t) {

    var invalid = [
        // fields
        [ { fields: 1, name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: {}, name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ 1 ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ {} ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.emptyArray) ],
        [ { fields: [ 'foo' ], name: 'asdf' },
            mod_err.invalidParam('fields', 'unknown field specified') ],
        [ { fields: [ 'a', 'b', 'c', 'd', 'e' ], name: 'asdf' },
            mod_err.invalidParam('fields',
                    'can only specify a maximum of 5 fields') ],

        // owner_uuid
        [ { owner_uuid: 'asdf' },
            mod_err.invalidParam('owner_uuid', mod_err.msg.uuid) ],

        // name
        [ { name: {} },
            mod_err.invalidParam('name', mod_err.msg.str) ],
        [ { name: LONG_STR },
            mod_err.invalidParam('name', mod_err.msg.longStr) ],

        // description
        [ { description: {} },
            mod_err.invalidParam('description', mod_err.msg.str) ],
        [ { description: LONG_STR },
            mod_err.invalidParam('description', mod_err.msg.longStr) ],

        // vlan_id
        [ { vlan_id: -1 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ],
        [ { vlan_id: 1 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ],
        [ { vlan_id: 4095 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ]
    ];

    mod_vasync.forEachParallel({
        inputs: invalid,
        func: function _createInvalidVLAN(params, cb) {
            var baseParams = {
                owner_uuid: mod_uuid.v4(),
                vlan_id: 56
            };

            mod_vlan.create(t, {
                params: extend(baseParams, params[0]),
                expErr: params[1]
            }, cb);
        }
    }, function () {
        return t.end();
    });
});


test('invalid vlan_id and owner_uuid: create and update', function (tt) {

    // Get VLAN 0 and make sure it's the same
    function _getVLAN(t) {
        mod_vlan.get(t, {
            params: {
                owner_uuid: VLANS[0].owner_uuid,
                vlan_id: VLANS[0].vlan_id
            },
            exp: VLANS[0]
        });
    }


    tt.test('create', function (t) {
        var params = {
            name: mod_vlan.randomName(),
            vlan_id: 'asdf'
        };
        var path = fmt('/fabrics/%s/vlans', OWNERS[0]);

        NAPI.client.post(path, params, function (err, req, res, _obj) {
            t.ok(err, 'error returned');
            if (err) {
                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, mod_err.invalidParam('vlan_id',
                        mod_err.msg.vlan), 'error body');
            }

            return t.end();
        });
    });


    tt.test('update: invalid vlan_id', function (t) {
        var params = {
            name: 'new name'
        };
        var path = fmt('/fabrics/%s/vlans/asdf', OWNERS[0]);

        NAPI.client.put(path, params, function (err, req, res, _obj) {
            t.ok(err, 'error returned');
            if (err) {
                t.equal(err.statusCode, 422, 'status code');
                t.deepEqual(err.body, mod_err.invalidParam('vlan_id',
                        mod_err.msg.vlan), 'error body');
            }

            return t.end();
        });
    });


    tt.test('update: non-existent vlan_id', function (t) {
        var params = {
            name: 'new name'
        };
        var path = fmt('/fabrics/%s/vlans/500', OWNERS[0]);

        NAPI.client.put(path, params, function (err, req, res, _obj) {
            t.ok(err, 'error returned');
            if (err) {
                t.equal(err.statusCode, 404, 'status code');
                t.deepEqual(err.body, mod_err.notFound('vlan'), 'error body');
            }

            return t.end();
        });
    });


    tt.test('update: invalid vlan_id in params', function (t) {
        var params = {
            vlan_id: 'asdf'
        };
        var path = fmt('/fabrics/%s/vlans/%d', OWNERS[0], VLANS[0].vlan_id);

        NAPI.client.put(path, params, function (err, req, res, _obj) {
            common.ifErr(t, err, 'after PUT');
            return t.end();
        });
    });


    tt.test('get: after invalid vlan_id', _getVLAN);


    // Make sure we can't change the VLAN ID out from under using the request
    // params
    tt.test('update: other vlan_id in params', function (t) {
        var params = {
            vlan_id: 67
        };
        var path = fmt('/fabrics/%s/vlans/%d', OWNERS[0], VLANS[0].vlan_id);

        NAPI.client.put(path, params, function (err, req, res, _obj) {
            common.ifErr(t, err, 'after PUT');
            return t.end();
        });
    });


    tt.test('get: after other vlan_id', _getVLAN);


    // Try to change the owner of the VLAN
    tt.test('update: other owner_uuid in params', function (t) {
        var params = {
            owner_uuid: OWNERS[1]
        };
        var path = fmt('/fabrics/%s/vlans/%d', OWNERS[0], VLANS[0].vlan_id);

        NAPI.client.put(path, params, function (err, req, res, _obj) {
            common.ifErr(t, err, 'after PUT');
            return t.end();
        });
    });


    tt.test('get: after other owner_uuid', _getVLAN);


    // And make sure that this didn't assign the VLAN to the other owner
    tt.test('get: same VLAN, other owner', function (t) {
        mod_vlan.get(t, {
            params: {
                owner_uuid: OWNERS[1],
                vlan_id: VLANS[0].vlan_id
            },
            expCode: 404,
            expErr: mod_err.notFound('vlan')
        });
    });

});


test('create invalid networks', function (t) {

    var resolverErr = mod_err.invalidParam('resolvers', mod_err.msg.ip,
            [ 'asdf' ]);

    var invalid = [
        // fields
        [ { fields: 1, name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: {}, name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ 1 ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ {} ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.strArray) ],
        [ { fields: [ ], name: 'asdf' },
            mod_err.invalidParam('fields', mod_err.msg.emptyArray) ],
        [ { fields: [ 'foo' ], name: 'asdf' },
            mod_err.invalidParam('fields', 'unknown field specified') ],
        [ { fields: [ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k',
          'l', 'm', 'n', 'o', 'p' ], name: 'asdf' },
            mod_err.invalidParam('fields',
                    'can only specify a maximum of 16 fields') ],

        // owner_uuid
        [ { owner_uuid: 'asdf' },
            mod_err.invalidParam('owner_uuid', mod_err.msg.uuid) ],

        // name
        [ { name: {} },
            mod_err.invalidParam('name', mod_err.msg.str) ],
        [ { name: LONG_STR },
            mod_err.invalidParam('name', mod_err.msg.longStr) ],

        // description
        [ { description: {} },
            mod_err.invalidParam('description', mod_err.msg.str) ],
        [ { description: LONG_STR },
            mod_err.invalidParam('description', mod_err.msg.longStr) ],

        // vlan_id
        [ { vlan_id: -1 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ],
        [ { vlan_id: 1 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ],
        [ { vlan_id: 4095 },
            mod_err.invalidParam('vlan_id', mod_err.msg.vlan) ],

        // resolvers
        [ { resolvers: {} },
            mod_err.invalidParam('resolvers', mod_err.msg.strArray) ],
        [ { resolvers: 'asdf' }, resolverErr ],
        [ { resolvers: [ 'asdf' ] }, resolverErr ],

        // routes
        [ { routes: [] },
            mod_err.invalidParam('routes', mod_err.msg.obj) ],
        [ { routes: 'asdf' },
            mod_err.invalidParam('routes', mod_err.msg.obj) ],
        [ { routes: { asdf: 'foo' } },
            mod_err.invalidParam('routes', mod_err.msg.route,
            [ 'asdf', 'foo' ]) ],

        // subnet
        [ { subnet: [] },
            mod_err.invalidParam('subnet', mod_err.msg.str) ],
        [ { subnet: 'asdf' },
            mod_err.invalidParam('subnet', mod_err.msg.cidr) ],
        [ { subnet: 'asdf/32' },
            mod_err.invalidParam('subnet', mod_err.msg.cidrIP) ],
        [ { subnet: '192.168.5.0/ab' },
            mod_err.invalidParam('subnet', mod_err.msg.cidrBits) ],
        [ { subnet: '172.16.0.1/22' },
            mod_err.invalidParam('subnet', mod_err.msg.cidrInvalid) ]
    ];

    mod_vasync.forEachParallel({
        inputs: invalid,
        func: function _createInvalidNet(params, cb) {
            var baseParams = {
                gateway: '172.16.1.2',
                name: mod_fabric_net.generateName('fields'),
                owner_uuid: OWNERS[0],
                provision_start_ip: '172.16.1.2',
                provision_end_ip: '172.16.3.254',
                subnet: '172.16.0.0/22',
                vlan_id: VLANS[0].vlan_id
            };

            mod_fabric_net.create(t, {
                desc: JSON.stringify(params[0]),
                params: extend(baseParams, params[0]),
                expErr: params[1]
            }, cb);
        }
    }, function () {
        return t.end();
    });
});


// The purpose of this block of tests is to try and see if users can see or
// modify the networks of other users
test('networks: overriding owner_uuid', function (tt) {

    var created = [];

    tt.test('create vlan 1', function (t) {
        mod_vlan.createAndGet(t, {
            params: VLANS[1],
            exp: VLANS[1]
        });
    });


    tt.test('create vlan 2', function (t) {
        mod_vlan.createAndGet(t, {
            params: VLANS[2],
            exp: VLANS[2]
        });
    });


    tt.test('override owner_uuid', function (t) {
        var params = {
            name: mod_fabric_net.generateName('fields'),
            owner_uuid: OWNERS[1],
            provision_start_ip: '172.16.4.1',
            provision_end_ip: '172.16.5.254',
            subnet: '172.16.4.0/22',
            vlan_id: VLANS[0].vlan_id
        };
        var path = fmt('/fabrics/%s/vlans/%d/networks', OWNERS[0],
            VLANS[0].vlan_id);

        t.ok(OWNERS[0], 'OWNERS[0]: ' + OWNERS[0]);
        t.ok(OWNERS[1], 'OWNERS[1]: ' + OWNERS[1]);

        NAPI.client.post(extend({ path: path }, common.reqOpts(t)), params,
                function (err, req, res, obj) {
            h.ifErr(t, err, 'error returned');
            if (obj) {
                t.equal(obj.owner_uuid, OWNERS[0], 'correct owner');
                created.push(obj.uuid);
            }

            return t.end();
        });
    });


    // Make sure OWNERS[0] actually owns the network
    tt.test('get: overridden: correct owner', function (t) {
        mod_fabric_net.get(t, {
            params: {
                uuid: created[0],
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[0].vlan_id
            },
            partialExp: {
                owner_uuid: OWNERS[0],
                subnet: '172.16.4.0/22',
                vlan_id: VLANS[0].vlan_id
            }
        });
    });


    // Make sure the other owner's network didn't get created
    tt.test('get: overridden: other owner', function (t) {
        mod_fabric_net.get(t, {
            params: {
                uuid: created[0],
                owner_uuid: OWNERS[1],
                vlan_id: VLANS[0].vlan_id
            },
            expCode: 404,
            expErr: mod_err.notFound('network')
        });
    });


    tt.test('get: overriden: other owner in params', function (t) {
        var params = {
            owner_uuid: OWNERS[0]
        };
        var path = fmt('/fabrics/%s/vlans/%d/networks/%s', OWNERS[1],
            VLANS[0].vlan_id, created[0]);

        NAPI.client.get(extend({ path: path, query: params },
                common.reqOpts(t)), function (err, req, res, obj) {
            t.ok(err, 'error returned');
            if (err) {
                t.deepEqual(err.body, mod_err.notFound('network'), 'body');
            } else {
                t.deepEqual(obj, {}, 'body (unexpected)');
            }

            return t.end();
        });
    });


    tt.test('del: other owner in params', function (t) {
        var params = {
            owner_uuid: OWNERS[0]
        };
        var path = fmt('/fabrics/%s/vlans/%d/networks/%s', OWNERS[1],
            VLANS[0].vlan_id, created[0]);

        NAPI.client.del(extend({ path: path, query: params },
                common.reqOpts(t)), function (err, req, res, obj) {
            t.ok(err, 'error returned');
            if (err) {
                t.deepEqual(err.body, mod_err.notFound('network'), 'body');
            } else {
                t.deepEqual(obj, {}, 'body (unexpected)');
            }

            return t.end();
        });
    });


    // Try getting the admin network
    tt.test('get: admin network', function (t) {
        mod_fabric_net.get(t, {
            params: {
                uuid: 'admin',
                owner_uuid: OWNERS[1],
                vlan_id: 0
            },
            expCode: 404,
            expErr: mod_err.notFound('network')
        });
    });


    tt.test('del: admin network', function (t) {
        mod_fabric_net.del(t, {
            params: {
                uuid: 'admin',
                owner_uuid: OWNERS[1],
                vlan_id: 0
            },
            expCode: 404,
            expErr: mod_err.notFound('network')
        });
    });


    tt.test('del: created[0]', function (t) {
        if (!created[0]) {
            return t.end();
        }

        mod_fabric_net.del(t, {
            params: {
                uuid: created[0],
                owner_uuid: OWNERS[0],
                vlan_id: VLANS[0].vlan_id
            },
            exp: {}
        });
    });

});



// Limit tests:
//
// Try to create over 1k (the limit) for:
// - vlans
// - networks



test('teardown', function (t) {

    t.test('delete created fabric networks', mod_fabric_net.delAllCreated);

    t.test('delete created VLANs', mod_vlan.delAllCreated);

});
