/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_uuid = require('node-uuid');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var ADMIN_NET;
var NAPI;
var NET;
var NET2;
var NET3;



// --- Internal helpers



// --- Setup



exports['Initial setup'] = function (t) {
    helpers.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.done();
        }

        var netParams = helpers.validNetworkParams();

        vasync.pipeline({
        funcs: [
            function _nicTag(_, cb) {
                NAPI.createNicTag(netParams.nic_tag, cb);
            },

            function _testNet(_, cb) {
                NAPI.createNetwork(netParams, function (err2, res2) {
                    NET = res2;
                    cb(err2);
                });
            },

            function _testNet2(_, cb) {
                NAPI.createNetwork(helpers.validNetworkParams({ vlan_id: 46 }),
                    function (err2, res2) {
                    NET2 = res2;
                    cb(err2);
                });
            },

            function _testNet3(_, cb) {
                NAPI.createNetwork(helpers.validNetworkParams({ vlan_id: 47 }),
                    function (err2, res2) {
                    NET3 = res2;
                    cb(err2);
                });
            },

            function _adminNet(_, cb) {
                var params = helpers.validNetworkParams({ name: 'admin' });
                NAPI.createNetwork(params, function (err2, res2) {
                    ADMIN_NET = res2;
                    cb(err2);
                });
            }

        ] }, function (overallErr) {
            t.ifError(overallErr);
            return t.done();
        });
    });
};



// --- Create tests



exports['Create nic - mising params'] = function (t) {
    NAPI.post('/nics', {}, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                helpers.missingParam('belongs_to_type', 'Missing parameter'),
                helpers.missingParam('belongs_to_uuid', 'Missing parameter'),
                helpers.missingParam('owner_uuid', 'Missing parameter')
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic - missing params'] = function (t) {
    NAPI.provisionNic(NET.uuid, { }, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                helpers.missingParam('belongs_to_type'),
                helpers.missingParam('belongs_to_uuid'),
                helpers.missingParam('owner_uuid')
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic - all invalid params'] = function (t) {
    var params = {
        belongs_to_type: '',
        belongs_to_uuid: 'asdf',
        ip: 'foo',
        mac: 'asdf',
        model: '',
        network_uuid: 'asdf',
        nic_tag: 'does_not_exist',
        nic_tags_provided: ['does', 'not', 'exist'],
        owner_uuid: 'invalid',
        primary: 'asdf',
        reserved: 'invalid',
        vlan_id: 'a'
    };

    NAPI.createNic('foobar', params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, helpers.invalidParamErr({
            errors: [
                mod_err.invalidParam('belongs_to_type', 'must not be empty'),
                mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                mod_err.invalidParam('ip', 'invalid IP address'),
                mod_err.invalidParam('mac', 'invalid MAC address'),
                mod_err.invalidParam('model', 'must not be empty'),
                mod_err.invalidParam('network_uuid', 'invalid UUID'),
                mod_err.invalidParam('nic_tag', 'nic tag does not exist'),
                {
                    code: 'InvalidParameter',
                    field: 'nic_tags_provided',
                    invalid: params.nic_tags_provided,
                    message: 'nic tags do not exist'
                },
                mod_err.invalidParam('owner_uuid', 'invalid UUID'),
                mod_err.invalidParam('primary', 'must be a boolean value'),
                mod_err.invalidParam('reserved', 'must be a boolean value'),
                mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic - network_uuid=admin'] = function (t) {
    var params = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid: mod_uuid.v4()
    };

    NAPI.provisionNic('admin', params, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        var exp = {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: res.ip,
            mac: res.mac,
            netmask: ADMIN_NET.netmask,
            network_uuid: ADMIN_NET.uuid,
            nic_tag: ADMIN_NET.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: ADMIN_NET.resolvers,
            vlan_id: ADMIN_NET.vlan_id
        };
        t.deepEqual(res, exp, 'response');

        NAPI.getNic(res.mac, function (err2, res2) {
            t.ifError(err2);
            t.deepEqual(res2, exp, 'get response');
            return t.done();
        });

    });
};


exports['Create nic - invalid params'] = function (t) {
    var owner = mod_uuid.v4();
    var type = 'server';
    var uuid = mod_uuid.v4();

    var invalid = [
        [ 'IP address outside subnet',
            { ip: '10.0.3.1', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid },
                [ mod_err.invalidParam('ip', 'ip cannot be outside subnet') ] ],

        [ 'IP specified, but not nic_tag or vlan_id',
            { ip: '10.0.2.2', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner },
                [ helpers.missingParam('nic_tag',
                    'required if IP specified but not network_uuid'),
                helpers.missingParam('vlan_id',
                    'required if IP specified but not network_uuid') ],
                'Missing parameters' ],

        [ 'Non-existent network',
            { ip: '10.0.2.2', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: mod_uuid.v4() },
                [ mod_err.invalidParam('network_uuid',
                    'network does not exist') ] ],

        [ 'nic_tag and vlan_id present, IP outside subnet',
            { ip: '10.0.3.1', belongs_to_type: type, belongs_to_uuid: uuid,
                nic_tag: NET2.nic_tag, owner_uuid: owner,
                vlan_id: NET2.vlan_id },
                [ mod_err.invalidParam('ip', 'ip cannot be outside subnet') ] ],

        [ 'nic_tag and vlan_id do not match any networks',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                nic_tag: NET.nic_tag, owner_uuid: owner, vlan_id: 656 },
                [ mod_err.invalidParam('nic_tag',
                    'No networks found matching parameters'),
                mod_err.invalidParam('vlan_id',
                    'No networks found matching parameters') ] ]

    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (data, cb) {
            NAPI.createNic(helpers.randomMAC(), data[1], function (err, res) {
                t.ok(err, 'error returned: ' + data[0]);
                if (!err) {
                    return cb();
                }

                t.deepEqual(err.body, helpers.invalidParamErr({
                    message: data[3] || 'Invalid parameters',
                    errors: data[2]
                }), 'Error body');

                return cb();
            });
        }
    }, function () {
        return t.done();
    });
};


exports['Provision nic'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        t.deepEqual(res, {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: NET2.provision_start_ip,
            mac: res.mac,
            netmask: '255.255.255.0',
            network_uuid: NET2.uuid,
            nic_tag: NET2.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET2.resolvers,
            vlan_id: NET2.vlan_id
        }, 'result');

        return t.done();
    });
};


exports['Provision nic - with IP'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.200',
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        t.deepEqual(res, {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: '10.0.2.200',
            mac: res.mac,
            netmask: '255.255.255.0',
            network_uuid: NET2.uuid,
            nic_tag: NET2.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET2.resolvers,
            vlan_id: NET2.vlan_id
        }, 'result');

        return t.done();
    });
};



// --- Update tests



exports['Update nic - add IP'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var mac = helpers.randomMAC();

    NAPI.createNic(mac, params, function (err, res) {
        t.ifError(err);
        if (err) {
            t.deepEqual(err.body, {}, 'error body');
            return t.done();
        }

        NAPI.updateNic(mac, { network_uuid: NET3.uuid }, function (err2, res2) {
            t.ifError(err2);
            if (err2) {
                t.deepEqual(err2.body, {}, 'error body');
                return t.done();
            }

            t.deepEqual(res2, {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: NET2.provision_start_ip,
                mac: res2.mac,
                netmask: '255.255.255.0',
                network_uuid: NET3.uuid,
                nic_tag: NET3.nic_tag,
                owner_uuid: params.owner_uuid,
                primary: false,
                resolvers: NET3.resolvers,
                vlan_id: NET3.vlan_id
            }, 'result');

            return t.done();
        });
    });
};


exports['Update nic - IP parameters updated'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: '10.0.2.188',
        network_uuid: NET.uuid,
        owner_uuid:  mod_uuid.v4()
    };
    var mac = helpers.randomMAC();
    var exp = {
        belongs_to_type: params.belongs_to_type,
        belongs_to_uuid: params.belongs_to_uuid,
        ip: params.ip,
        mac: mac,
        netmask: '255.255.255.0',
        network_uuid: NET.uuid,
        nic_tag: NET.nic_tag,
        owner_uuid: params.owner_uuid,
        primary: false,
        resolvers: NET.resolvers,
        vlan_id: NET.vlan_id
    };

    vasync.pipeline({
        funcs: [
        function _create(_, cb) {
            NAPI.createNic(mac, params, function (err, res) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                    return cb(err);
                }

                t.deepEqual(res, exp, 'result');
                return cb();
            });
        },

        function _update(_, cb) {
            var updateParams = {
                belongs_to_type: 'other',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid:  mod_uuid.v4()
            };

            for (var k in updateParams) {
                exp[k] = updateParams[k];
            }

            NAPI.updateNic(mac, updateParams, function (err, res) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                    return cb(err);
                }

                t.deepEqual(res, exp, 'result after update');
                return cb();
            });
        },

        function _getNic(_, cb) {
            NAPI.getNic(mac, function (err, res) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                    return cb(err);
                }

                t.deepEqual(res, exp, 'get nic after update');
                return cb();
            });
        },

        function _getIP(_, cb) {
            NAPI.getIP(NET.uuid, exp.ip, function (err, res) {
                t.ifError(err);
                if (err) {
                    t.deepEqual(err.body, {}, 'error body');
                    return cb(err);
                }

                t.deepEqual(res, {
                    belongs_to_type: exp.belongs_to_type,
                    belongs_to_uuid: exp.belongs_to_uuid,
                    free: false,
                    ip: exp.ip,
                    owner_uuid: exp.owner_uuid,
                    reserved: false
                }, 'get IP after update');
                return cb();
            });
        }
    ] }, function () {
        return t.done();
    });
};


exports['Update nic - all invalid params'] = function (t) {
    var mac = helpers.randomMAC();
    var goodParams = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    var badParams = {
        belongs_to_type: '',
        belongs_to_uuid: 'asdf',
        ip: 'foo',
        mac: 'asdf',
        model: '',
        network_uuid: 'asdf',
        nic_tag: 'does_not_exist',
        nic_tags_provided: ['does', 'not', 'exist'],
        owner_uuid: 'invalid',
        primary: 'invalid',
        reserved: 'invalid',
        vlan_id: 'a'
    };

    NAPI.createNic(mac, goodParams, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        NAPI.updateNic(mac, badParams, function (err2, res2) {
            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, helpers.invalidParamErr({
                errors: [
                    mod_err.invalidParam('belongs_to_type',
                        'must not be empty'),
                    mod_err.invalidParam('belongs_to_uuid', 'invalid UUID'),
                    mod_err.invalidParam('ip', 'invalid IP address'),
                    mod_err.invalidParam('model', 'must not be empty'),
                    mod_err.invalidParam('network_uuid', 'invalid UUID'),
                    mod_err.invalidParam('nic_tag', 'nic tag does not exist'),
                    {
                        code: 'InvalidParameter',
                        field: 'nic_tags_provided',
                        invalid: badParams.nic_tags_provided,
                        message: 'nic tags do not exist'
                    },
                    mod_err.invalidParam('owner_uuid', 'invalid UUID'),
                    mod_err.invalidParam('primary', 'must be a boolean value'),
                    mod_err.invalidParam('reserved', 'must be a boolean value'),
                    mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
                ]
            }), 'Error body');

            return t.done();
        });

    });
};


exports['Update nic - invalid params'] = function (t) {
    var mac = helpers.randomMAC();
    var goodParams = {
        belongs_to_type: 'server',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    var invalid = [
        [ 'IP address outside subnet',
            { ip: '10.0.3.1', network_uuid: NET.uuid },
                [ mod_err.invalidParam('ip', 'ip cannot be outside subnet') ] ],

        [ 'IP specified, but not nic_tag or vlan_id',
            { ip: '10.0.2.2' },
                [ helpers.missingParam('nic_tag',
                    'required if IP specified but not network_uuid'),
                helpers.missingParam('vlan_id',
                    'required if IP specified but not network_uuid') ],
                'Missing parameters' ],

        [ 'Non-existent network',
            { ip: '10.0.2.2', network_uuid: mod_uuid.v4() },
                [ mod_err.invalidParam('network_uuid',
                    'network does not exist') ] ],

        [ 'nic_tag and vlan_id present, IP outside subnet',
            { ip: '10.0.3.1', nic_tag: NET2.nic_tag, vlan_id: NET2.vlan_id },
                [ mod_err.invalidParam('ip', 'ip cannot be outside subnet') ] ],

        [ 'nic_tag and vlan_id do not match any networks',
            { ip: '10.0.2.3', nic_tag: NET.nic_tag, vlan_id: 656 },
                [ mod_err.invalidParam('nic_tag',
                    'No networks found matching parameters'),
                mod_err.invalidParam('vlan_id',
                    'No networks found matching parameters') ] ]
    ];

    NAPI.createNic(mac, goodParams, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        vasync.forEachParallel({
            inputs: invalid,
            func: function (data, cb) {
                NAPI.updateNic(mac, data[1], function (err2, res2) {
                    t.ok(err2, 'error returned: ' + data[0]);
                    if (!err2) {
                        return cb();
                    }

                    t.equal(err2.statusCode, 422, 'status code');
                    t.deepEqual(err2.body, helpers.invalidParamErr({
                        message: data[3] || 'Invalid parameters',
                        errors: data[2]
                    }), 'Error body');

                    return cb();
                });
            }
        }, function () {
            return t.done();
        });
    });
};



// XXX: More tests:
// - create nic with IP, then create another nic with the same IP.  Old nic
//   should no longer have that IP
// - nic already has IP, then update to new IP
//   - old IP should not belong to anyone anymore
//   - same should be true if that nic moves networks
// - should not allow updating an IP to outside the subnet (if only the IP
//   is specified)



// --- Teardown



exports['Stop server'] = function (t) {
    helpers.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports['Initial setup'],
        oneTest: runOne,
        teardown: exports['Stop server']
    };
}
