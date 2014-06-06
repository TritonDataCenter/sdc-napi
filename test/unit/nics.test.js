/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var ip_common = require('../../lib/models/ip/common');
var mod_err = require('../../lib/util/errors');
var mod_ip = require('../lib/ip');
var mod_nic = require('../lib/nic');
var mod_uuid = require('node-uuid');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var restify = require('restify');
var util = require('util');
var util_mac = require('../../lib/util/mac');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var d = {};
var runOne;
var ADMIN_NET;
var NAPI;
var NET;
var NET2;
var NET3;
var PROV_MAC_NET;



// --- Helpers



/**
 * Get a nic object from moray
 */
function getMorayNic(t, macAddr) {
    var macNum = util_mac.aton(macAddr);
    t.ok(macNum, 'mac number');
    var morayObj = h.morayObj('napi_nics', macNum);

    t.ok(morayObj, 'moray object exists');
    return morayObj;
}



// --- Setup



exports['Initial setup'] = function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;

        if (!NAPI) {
            return t.done();
        }

        var netParams = h.validNetworkParams();

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
                NAPI.createNetwork(h.validNetworkParams({
                    routes: {
                      '10.0.3.4': '10.0.2.2',
                      '10.0.4.0/24': '10.0.2.2'
                    },
                    vlan_id: 46
                }), function (err2, res2) {
                    NET2 = res2;
                    cb(err2);
                });
            },

            function _testNet3(_, cb) {
                NAPI.createNetwork(h.validNetworkParams({ vlan_id: 47 }),
                    function (err2, res2) {
                    NET3 = res2;
                    cb(err2);
                });
            },

            function _adminNet(_, cb) {
                var params = h.validNetworkParams({ name: 'admin' });
                NAPI.createNetwork(params, function (err2, res2) {
                    ADMIN_NET = res2;
                    cb(err2);
                });
            },

            function _macNet3(_, cb) {
                NAPI.createNetwork(h.validNetworkParams({ vlan_id: 48 }),
                    function (err2, res2) {
                    PROV_MAC_NET = res2;
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
        t.deepEqual(err.body, h.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                h.missingParam('belongs_to_type', 'Missing parameter'),
                h.missingParam('belongs_to_uuid', 'Missing parameter'),
                h.missingParam('owner_uuid', 'Missing parameter')
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
        t.deepEqual(err.body, h.invalidParamErr({
            message: 'Missing parameters',
            errors: [
                h.missingParam('belongs_to_type'),
                h.missingParam('belongs_to_uuid'),
                h.missingParam('owner_uuid')
            ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic - all invalid params'] = function (t) {
    var params = {
        allow_dhcp_spoofing: 'asdf',
        allow_ip_spoofing: 'asdf',
        allow_mac_spoofing: 'asdf',
        allow_restricted_traffic: 'asdf',
        allow_unfiltered_promisc: 'asdf',
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
        status: 'oogabooga',
        vlan_id: 'a'
    };

    NAPI.createNic('foobar', params, function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('allow_dhcp_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_ip_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_mac_spoofing',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_restricted_traffic',
                    'must be a boolean value'),
                mod_err.invalidParam('allow_unfiltered_promisc',
                    'must be a boolean value'),
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
                mod_err.invalidParam('status', 'must be a valid state'),
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
            status: 'running',
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
                [ h.missingParam('nic_tag',
                    'required if IP specified but not network_uuid'),
                h.missingParam('vlan_id',
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
                    'No networks found matching parameters') ] ],

        [ 'status must be a string',
            { ip: '10.0.2.3', belongs_to_type: type, belongs_to_uuid: uuid,
                owner_uuid: owner, network_uuid: NET.uuid, status: true },
                [ mod_err.invalidParam('status', 'must be a string') ] ]
    ];

    vasync.forEachParallel({
        inputs: invalid,
        func: function (data, cb) {
            NAPI.createNic(h.randomMAC(), data[1], function (err, res) {
                t.ok(err, 'error returned: ' + data[0]);
                if (!err) {
                    return cb();
                }

                t.deepEqual(err.body, h.invalidParamErr({
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


exports['Create nic - empty nic_tags_provided'] = {
    'create': function (t) {
        d = {};
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            nic_tags_provided: '',
            owner_uuid: mod_uuid.v4()
        };

        NAPI.createNic(h.randomMAC(), d.params, function (err, res) {
            if (h.ifErr(t, err, 'create nic with empty nic_tags_provided')) {
                return t.done();
            }

            delete d.params.nic_tags_provided;
            d.params.primary = false;
            d.params.mac = res.mac;
            d.params.status = 'running';
            t.deepEqual(res, d.params, 'response');

            return t.done();
        });
    },

    'get': function (t) {
        NAPI.getNic(d.params.mac, function (err, res) {
            t.ifError(err);
            t.deepEqual(res, d.params, 'get response');
            return t.done();
        });
    },

    'create with same MAC': function (t) {
        d.params2 = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid: mod_uuid.v4()
        };

        NAPI.createNic(d.params.mac, d.params2, function (err, res) {
            t.ok(err, 'error returned');
            if (!err) {
                return t.done();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('mac') ]
            }), 'Error body');

            return t.done();
        });
    }
};



// --- Provision tests



exports['Provision nic'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        if (h.ifErr(t, err, 'provision nic')) {
            return t.done();
        }

        var exp = {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: h.nextProvisionableIP(NET2),
            mac: res.mac,
            netmask: '255.255.255.0',
            network_uuid: NET2.uuid,
            nic_tag: NET2.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET2.resolvers,
            routes: NET2.routes,
            status: 'running',
            vlan_id: NET2.vlan_id
        };
        t.deepEqual(res, exp, 'result');

        NAPI.getNic(res.mac, function (err2, res2) {
            if (h.ifErr(t, err2, 'get provisioned nic')) {
                return t.done();
            }

            t.deepEqual(res2, exp, 'get result');
            return t.done();
        });
    });
};


exports['Provision nic: exceed MAC retries'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var numNicsBefore = h.getNicRecords().length;

    var errs = [ ];
    for (var i = 0; i < constants.MAC_RETRIES + 1; i++) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };
        errs.push(fakeErr);
    }
    h.setMorayErrors({ batch: errs });

    NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 500, 'status code');
        t.deepEqual(err.body, {
            code: 'InternalError',
            message: 'no more free MAC addresses'
        }, 'Error body');

        // Confirm that the IP was freed
        NAPI.getIP(PROV_MAC_NET.uuid, PROV_MAC_NET.provision_start_ip,
            function (err2, res) {
            if (h.ifErr(t, err2, 'getIP error')) {
                return t.done();
            }

            t.equal(res.free, true, 'IP has been freed');
            var ipRec = h.getIPrecord(PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip);
            t.ok(!ipRec, 'IP record does not exist in moray');

            t.equal(h.getNicRecords().length, numNicsBefore,
                'no new nic records added');

            // Make sure we actually hit all of the errors:
            t.deepEqual(h.getMorayErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.done();
        });
    });
};


exports['Provision nic: exceed IP retries'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var numNicsBefore = h.getNicRecords().length;

    var errs = [ ];
    for (var i = 0; i < constants.IP_PROVISION_RETRIES + 2; i++) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };
        errs.push(fakeErr);
    }
    h.setMorayErrors({ batch: errs });

    NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 507, 'status code');
        t.deepEqual(err.body, {
            code: 'SubnetFull',
            message: constants.SUBNET_FULL_MSG
        }, 'Error body');

        // Confirm that the IP was freed
        NAPI.getIP(PROV_MAC_NET.uuid, PROV_MAC_NET.provision_start_ip,
            function (err2, res) {
            if (h.ifErr(t, err2, 'getIP error')) {
                return t.done();
            }

            t.equal(res.free, true, 'IP has been freed');
            var ipRec = h.getIPrecord(PROV_MAC_NET.uuid,
                PROV_MAC_NET.provision_start_ip);
            t.ok(!ipRec, 'IP record does not exist in moray');

            t.equal(h.getNicRecords().length, numNicsBefore,
                'no new nic records added');

            // Make sure we actually hit all of the errors:
            t.deepEqual(h.getMorayErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.done();
        });
    });
};


exports['Provision nic: MAC retry'] = {
    'provision': function (t) {
        d = {};
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };

        h.setMorayErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provision nic with retry')) {
                return t.done();
            }

            d.mac = res.mac;
            t.ok(res.mac, 'MAC address');
            var macNum = util_mac.aton(res.mac);
            var morayObj = h.morayObj('napi_nics', macNum);
            t.ok(morayObj, 'found moray object');
            if (morayObj) {
                t.equal(morayObj.mac, macNum, 'correct mac in moray object');
            }

            t.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t.deepEqual(h.getMorayErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.done();
        });
    },

    'get': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
        });
    },

    'create': function (t) {
        d = {
            mac: h.randomMAC()
        };
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            network_uuid: PROV_MAC_NET.uuid,
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: 'napi_nics' };

        h.setMorayErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t, {
            mac: d.mac,
            params: params,
            expErr: h.invalidParamErr({
                    errors: [ mod_err.duplicateParam('mac') ]
                })
        }, function () {
            var morayObj = h.morayObj('napi_nics', util_mac.aton(d.mac));
            t.equal(morayObj, null, 'moray object does not exist');

            // We should have bailed after the first iteration of the loop:
            t.equal(h.getMorayErrors().batch.length, 1,
                'one error left');

            // Reset moray errors
            h.setMorayErrors({ });

            return t.done();
        });
    },

    'get created': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    }
};


exports['Provision nic: IP retry'] = {
    'provision': function (t) {
        d = {};
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        h.setMorayErrors({ batch: [ fakeErr, fakeErr ] });

        NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provision nic with retry')) {
                return t.done();
            }

            d.mac = res.mac;
            t.ok(res.mac, 'MAC address');
            var macNum = util_mac.aton(res.mac);
            var morayObj = h.morayObj('napi_nics', macNum);
            t.ok(morayObj, 'found moray object');
            if (morayObj) {
                t.equal(morayObj.mac, macNum, 'correct mac in moray object');
            }

            t.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t.deepEqual(h.getMorayErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.done();
        });
    },

    'get provisioned': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
        });
    },

    // Try the same again with a specified MAC, not a randomly-generated one

    'create': function (t) {
        d = {
            mac: h.randomMAC()
        };
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            network_uuid: PROV_MAC_NET.uuid,
            owner_uuid:  mod_uuid.v4()
        };

        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        fakeErr.context = { bucket: ip_common.bucketName(PROV_MAC_NET.uuid) };

        h.setMorayErrors({ batch: [ fakeErr, fakeErr ] });

        mod_nic.create(t, {
            mac: d.mac,
            params: params,
            partialExp: params
        }, function (err, res) {
            if (err) {
                return t.done();
            }

            t.ok(res.mac, 'MAC address');
            var macNum = util_mac.aton(res.mac);
            var morayObj = h.morayObj('napi_nics', macNum);
            t.ok(morayObj, 'found moray object');
            if (morayObj) {
                t.equal(morayObj.mac, macNum, 'correct mac in moray object');
            }

            t.equal(res.network_uuid, PROV_MAC_NET.uuid,
                'network_uuid correct');

            // Make sure we actually hit those errors:
            t.deepEqual(h.getMorayErrors(), {
                batch: [ ]
            }, 'no more batch errors left');

            return t.done();
        });
    },

    'get created': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            partialExp: {
                network_uuid: PROV_MAC_NET.uuid
            }
        });
    }
};


exports['Provision nic - with IP'] = {
    'provision': function (t) {
        d = {};
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: '10.0.2.200',
            owner_uuid: mod_uuid.v4()
        };

        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provision nic')) {
                return t.done();
            }

            d.exp = {
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
                routes: NET2.routes,
                status: 'running',
                vlan_id: NET2.vlan_id
            };
            t.deepEqual(res, d.exp, 'result');
            return t.done();
        });
    },

    'get': function (t) {
        if (!d.exp) {
            return t.done();
        }

        NAPI.getNic(d.exp.mac, function (err, res) {
            if (h.ifErr(t, err, 'get nic')) {
                return t.done();
            }

            t.deepEqual(res, d.exp, 'result');
            return t.done();
        });
    },

    'provision with duplicate IP': function (t) {
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: '10.0.2.200',
            owner_uuid: mod_uuid.v4()
        };

        mod_nic.provision(t, {
            net: NET2.uuid,
            params: params,
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', d.exp.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', d.exp.belongs_to_uuid))
                ]
            })
        });
    },

    // Try updating another nic to have that IP - it should fail

    'create second nic': function (t) {
        d.mac = h.randomMAC();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        mod_nic.create(t, {
            mac: d.mac,
            params: d.params,
            partialExp: d.params
        });
    },

    'update second nic': function (t) {
        mod_nic.update(t, {
            mac: d.mac,
            params: {
                ip: '10.0.2.200',
                network_uuid: NET2.uuid
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.duplicateParam('ip', util.format(
                        constants.fmt.IP_EXISTS, NET2.uuid))
                ]
            })
        });
    },

    // Try updating a nic with a different IP to have that IP

    'create third nic': function (t) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        d.exp3 = {
            ip: h.nextProvisionableIP(NET2)
        };
        h.copyParams(d.params, d.exp3);

        mod_nic.provision(t, {
            net: NET2.uuid,
            params: d.params,
            partialExp: d.exp3,
            // This will put the nic in d.nics[0]
            state: d
        });
    },

    'update third nic': function (t) {
        mod_nic.update(t, {
            mac: d.nics[0].mac,
            params: {
                ip: '10.0.2.200',
                network_uuid: NET2.uuid
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.usedByParam('ip', 'zone', d.exp.belongs_to_uuid,
                        util.format(constants.fmt.IP_IN_USE,
                            'zone', d.exp.belongs_to_uuid))
                ]
            })
        });
    }
};


exports['Provision nic - with different status'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4(),
        status: 'provisioning'
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        t.deepEqual(res, {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: h.nextProvisionableIP(NET2),
            mac: res.mac,
            netmask: '255.255.255.0',
            network_uuid: NET2.uuid,
            nic_tag: NET2.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET2.resolvers,
            routes: NET2.routes,
            status: 'provisioning',
            vlan_id: NET2.vlan_id
        }, 'result');

        NAPI.getNic(res.mac, function (err2, res2) {
            t.ifError(err2);
            t.deepEqual(res2, res, 'compare response with store');
            return t.done();
        });
    });
};



// --- Update tests



exports['Update nic - provision IP'] = {
    'create': function (t) {
        d.mac = h.randomMAC();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        mod_nic.create(t, {
            mac: d.mac,
            params: d.params,
            partialExp: d.params
        });

    },

    'update': function (t) {
        d.exp = {
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: NET3.provision_start_ip,
            mac: d.mac,
            netmask: '255.255.255.0',
            network_uuid: NET3.uuid,
            nic_tag: NET3.nic_tag,
            owner_uuid: d.params.owner_uuid,
            primary: false,
            resolvers: NET3.resolvers,
            status: 'running',
            vlan_id: NET3.vlan_id
        };

        mod_nic.update(t, {
            mac: d.mac,
            params: {
                network_uuid: NET3.uuid
            },
            exp: d.exp
        });
    },

    'get nic': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    'get IP': function (t) {
        mod_ip.get(t, {
            net: NET3.uuid,
            ip: NET3.provision_start_ip,
            exp: {
                belongs_to_type: d.exp.belongs_to_type,
                belongs_to_uuid: d.exp.belongs_to_uuid,
                free: false,
                ip: d.exp.ip,
                network_uuid: NET3.uuid,
                owner_uuid: d.exp.owner_uuid,
                reserved: false
            }
        });
    }
};


exports['Update nic - IP parameters updated'] = {
    'create': function (t) {
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: '10.0.2.188',
            network_uuid: NET.uuid,
            owner_uuid:  mod_uuid.v4()
        };
        d.mac = h.randomMAC();
        d.exp = {
            belongs_to_type: d.params.belongs_to_type,
            belongs_to_uuid: d.params.belongs_to_uuid,
            ip: d.params.ip,
            mac: d.mac,
            netmask: '255.255.255.0',
            network_uuid: NET.uuid,
            nic_tag: NET.nic_tag,
            owner_uuid: d.params.owner_uuid,
            primary: false,
            resolvers: NET.resolvers,
            status: 'running',
            vlan_id: NET.vlan_id
        };

        mod_nic.create(t, {
            mac: d.mac,
            params: d.params,
            exp: d.exp
        });
    },

    'get after create':  function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    'update': function (t) {
        var updateParams = {
            belongs_to_type: 'other',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        h.copyParams(updateParams, d.exp);
        mod_nic.update(t, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp
        });
    },

    'get after update': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    'get IP': function (t) {
        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.exp.ip,
            exp: {
                belongs_to_type: d.exp.belongs_to_type,
                belongs_to_uuid: d.exp.belongs_to_uuid,
                free: false,
                ip: d.exp.ip,
                network_uuid: NET.uuid,
                owner_uuid: d.exp.owner_uuid,
                reserved: false
            }
        });
    }
};


exports['Update nic - change IP'] = {
    'create': function (t) {
        d.ips = [ '10.0.2.196', '10.0.2.197', '10.0.2.198' ];
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            ip: d.ips[0],
            network_uuid: NET.uuid,
            owner_uuid:  mod_uuid.v4()
        };

        d.mac = h.randomMAC();
        d.exp = {
            belongs_to_type: params.belongs_to_type,
            belongs_to_uuid: params.belongs_to_uuid,
            ip: params.ip,
            mac: d.mac,
            netmask: '255.255.255.0',
            network_uuid: NET.uuid,
            nic_tag: NET.nic_tag,
            owner_uuid: params.owner_uuid,
            primary: false,
            resolvers: NET.resolvers,
            status: 'running',
            vlan_id: NET.vlan_id
        };
        d.other = mod_uuid.v4();

        mod_nic.create(t, {
            mac: d.mac,
            params: params,
            exp: d.exp
        });
    },

    'update: add IP': function (t) {
        var updateParams = {
            ip: d.ips[1],
            network_uuid: NET.uuid
        };

        for (var k in updateParams) {
            d.exp[k] = updateParams[k];
        }

        mod_nic.update(t, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp
        });
    },

    'get: after first update': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    'get old IP': function (t) {
        d.expIPs = [
            {
                free: true,
                ip: d.ips[0],
                network_uuid: NET.uuid,
                reserved: false
            }
        ];

        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[0],
            exp: d.expIPs[0]
        });
    },

    'get new IP': function (t) {
        d.expIPs.push({
            belongs_to_type: d.exp.belongs_to_type,
            belongs_to_uuid: d.exp.belongs_to_uuid,
            free: false,
            ip: d.ips[1],
            network_uuid: NET.uuid,
            owner_uuid: d.exp.owner_uuid,
            reserved: false
        });

        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    },

    // Reserve ips[2] so that it exists in moray
    'reserve ip 2': function (t) {
        d.expIPs.push({
            free: false,
            ip: d.ips[2],
            network_uuid: NET.uuid,
            reserved: true
        });

        mod_ip.update(t, {
            net: NET.uuid,
            ip: d.ips[2],
            exp: d.expIPs[2],
            params: {
                reserved: true
            }
        });
    },

    // Change belongs_to_uuid of ips[1]: the next update should leave it
    // alone, since the nic no longer owns it
    'change ip 1 belongs_to_uuid': function (t) {
        d.expIPs[1].belongs_to_uuid = d.other;

        mod_ip.update(t, {
            net: NET.uuid,
            ip: d.ips[1],
            params: {
                belongs_to_uuid: d.other
            },
            exp: d.expIPs[1]
        });
    },

    // confirm the change
    'get ip 1 after update': function (t) {
        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    },

    // Now update the nic so that it points to ip2
    'update nic to ip2': function (t) {
        var updateParams = {
            ip: d.ips[2],
            network_uuid: NET.uuid
        };

        h.copyParams(updateParams, d.exp);
        mod_nic.update(t, {
            mac: d.mac,
            params: updateParams,
            exp: d.exp
        });
    },

    'get: after update to ip2': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    'ip0 unchanged': function (t) {
        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[0],
            exp: d.expIPs[0]
        });
    },

    // ip1 should be unchanged as well, since it's no longer owned
    // by the nic we updated
    'ip1 unchanged': function (t) {
        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[1],
            exp: d.expIPs[1]
        });
    },

    // And finally, ip2 should have the nic as its owner now and still have
    // reserved set to true
    'ip2 unchanged': function (t) {
        d.expIPs[2] = {
            belongs_to_type: d.exp.belongs_to_type,
            belongs_to_uuid: d.exp.belongs_to_uuid,
            free: false,
            ip: d.ips[2],
            network_uuid: NET.uuid,
            owner_uuid: d.exp.owner_uuid,
            reserved: true
        };

        mod_ip.get(t, {
            net: NET.uuid,
            ip: d.ips[2],
            exp: d.expIPs[2]
        });
    }
};


exports['Update nic - all invalid params'] = function (t) {
    var mac = h.randomMAC();
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
        status: 'oogabooga',
        vlan_id: 'a'
    };

    NAPI.createNic(mac, goodParams, function (err, res) {
        t.ifError(err);
        if (err) {
            return t.done();
        }

        NAPI.updateNic(mac, badParams, function (err2, res2) {
            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, h.invalidParamErr({
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
                    mod_err.invalidParam('status', 'must be a valid state'),
                    mod_err.invalidParam('vlan_id', constants.VLAN_MSG)
                ]
            }), 'Error body');

            return t.done();
        });

    });
};


exports['Update nic - invalid params'] = function (t) {
    var mac = h.randomMAC();
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
                [ h.missingParam('nic_tag',
                    'required if IP specified but not network_uuid'),
                h.missingParam('vlan_id',
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
                    'No networks found matching parameters') ] ],

        [ 'status must be a valid state',
            { ip: '10.0.2.2', network_uuid: NET.uuid, status: 'oogabooga' },
                [ mod_err.invalidParam('status',
                    'must be a valid state') ] ]
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
                    t.deepEqual(err2.body, h.invalidParamErr({
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


// Test updates that should cause no changes to the nic object
exports['Update nic - no changes'] = {
    'provision': function (t) {
        d = {};
        var params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        var partialExp = {
            ip: h.nextProvisionableIP(NET2),
            network_uuid: NET2.uuid
        };
        h.copyParams(params, partialExp);

        mod_nic.provision(t, {
            net: NET2.uuid,
            params: params,
            state: d,
            partialExp: partialExp
        });
    },

    'update with same params': function (t) {
        mod_nic.update(t, {
            mac: d.nics[0].mac,
            params: d.nics[0],
            exp: d.nics[0]
        });
    },

    'get': function (t) {
        mod_nic.get(t, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
        });
    },

    // Update with only network_uuid set: this should not cause a new
    // IP to be provisioned for that nic
    'update with network_uuid': function (t) {
        mod_nic.update(t, {
            mac: d.nics[0].mac,
            params: {
                network_uuid: NET3.uuid
            },
            exp: d.nics[0]
        });
    },

    'get after network_uuid': function (t) {
        mod_nic.get(t, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
        });
    },

    // Changing the MAC address should not be allowed
    'update with mac': function (t) {
        d.newMAC = h.randomMAC();
        mod_nic.update(t, {
            mac: d.nics[0].mac,
            params: {
                mac: d.newMAC
            },
            exp: d.nics[0]
        });
    },

    'get after mac update': function (t) {
        mod_nic.get(t, {
            mac: d.nics[0].mac,
            exp: d.nics[0]
        });
    },

    // That update should not have created a new nic object with the
    // new MAC
    'get new MAC': function (t) {
        mod_nic.get(t, {
            mac: d.newMAC,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    }
};


exports['Update nic - change status'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    NAPI.provisionNic(NET2.uuid, params, function (err, res) {
        if (h.ifErr(t, err, 'provision new nic')) {
            return t.done();
        }

        for (var p in params) {
            t.equal(res[p], params[p], p + ' correct');
        }
        t.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

        t.equal(res.status, 'running');
        res.status = 'stopped';

        NAPI.updateNic(res.mac, res, function (err2, res2) {
            if (h.ifErr(t, err2, 'update nic')) {
                return t.done();
            }

            t.deepEqual(res2, res, 'Status changed to stopped');

            return t.done();
        });
    });
};


// Provision a nic, then change that IP's belongs_to_uuid to something
// else.  Deleting the nic should not free the IP (since it now belongs
// to something else).
exports['Delete nic - IP ownership changed underneath'] = function (t) {
    var ip;
    var nic;
    var other = mod_uuid.v4();
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    vasync.pipeline({ funcs: [
    function (_, cb) {
        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            if (h.ifErr(t, err, 'provision new nic')) {
                return cb(err);
            }

            nic = res;
            for (var p in params) {
                t.equal(nic[p], params[p], p + ' correct');
            }

            t.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            return cb();
        });
    },

    function (_, cb) {
       NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
           if (h.ifErr(t, err, 'update IP')) {
               return cb(err);
           }

           ip = res;
           t.equal(res.ip, nic.ip, 'IP');
           t.equal(res.belongs_to_uuid, params.belongs_to_uuid, 'IP');

           return cb();
       });
    },

    function (_, cb) {
       NAPI.updateIP(NET2.uuid, nic.ip, { belongs_to_uuid: other },
           function (err, res) {
           if (h.ifErr(t, err, 'update IP')) {
               return cb(err);
           }

           ip.belongs_to_uuid = other;
           t.deepEqual(res, ip, 'only belongs_to_uuid updated');

           return cb();
       });
    },

    function (_, cb) {
       NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
           if (h.ifErr(t, err, 'update IP')) {
               return cb(err);
           }

           t.deepEqual(res, ip, 'IP unchanged');

           return cb();
       });
    },

    function (_, cb) {
       NAPI.deleteNic(nic.mac, function (err, res) {
           if (h.ifErr(t, err, 'delete nic')) {
               return cb(err);
           }

           return cb();
       });
    },

    function (_, cb) {
       NAPI.getNic(nic.mac, function (err, res) {
           t.ok(err, 'error expected');
           if (!err) {
               return cb();
           }
           t.equal(err.statusCode, 404, '404 returned');

           return cb();
       });
    },

    function (_, cb) {
       NAPI.getIP(NET2.uuid, nic.ip, function (err, res) {
           if (h.ifErr(t, err, 'update IP')) {
               return cb(err);
           }

           t.deepEqual(res, ip, 'IP unchanged');

           return cb();
       });
    }

    ] }, function () {
        return t.done();
    });
};


exports['antispoof options'] = {
    'provision': function (t) {
        d.params = {
            allow_dhcp_spoofing: true,
            allow_ip_spoofing: true,
            allow_mac_spoofing: true,
            allow_restricted_traffic: true,
            allow_unfiltered_promisc: true,
            belongs_to_type: 'zone',
            belongs_to_uuid: mod_uuid.v4(),
            owner_uuid:  mod_uuid.v4()
        };

        mod_nic.provision(t, {
            net: NET2.uuid,
            params: d.params,
            partialExp: d.params
        }, function (err, res) {
            if (err) {
                return t.done();
            }

            d.exp = res;
            d.mac = res.mac;
            t.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');

            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t.done();
        });
    },

    'get after provision': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            partialExp: d.params
        });
    },

    'disable antispoof options': function (t) {
        d.updateParams = {
            allow_dhcp_spoofing: false,
            allow_ip_spoofing: false,
            allow_mac_spoofing: false,
            allow_restricted_traffic: false,
            allow_unfiltered_promisc: false
        };

        // If set to false, the fields won't appear in the API output
        // anymore:
        for (var p in d.updateParams) {
            delete d.exp[p];
        }

        mod_nic.update(t, {
            mac: d.mac,
            params: d.updateParams,
            exp: d.exp
        }, function (err, res) {
            if (err) {
                return t.done();
            }

            // Confirm that the fields have been removed from moray
            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t.done();
        });
    },

    'get after disable': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    },

    're-enable antispoof options': function (t) {
        for (var p in d.updateParams) {
            d.updateParams[p] = true;
            d.exp[p] = true;
        }

        mod_nic.update(t, {
            mac: d.mac,
            params: d.updateParams,
            exp: d.exp
        }, function (err, res) {
            if (err) {
                return t.done();
            }

            // Confirm that the fields have been removed from moray
            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return t.done();
        });
    },

    'get after re-enable': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            exp: d.exp
        });
    }
};


exports['update nic that does not exist'] = {
    'update first nic to set primary=true': function (t) {
        d = {
            mac: h.randomMAC(),
            params: {
                belongs_to_type: 'zone',
                belongs_to_uuid: mod_uuid.v4(),
                owner_uuid: mod_uuid.v4(),
                network_uuid: NET2.uuid
            }
        };

        mod_nic.update(t, {
            mac: d.mac,
            params: d.params,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    },

    'get': function (t) {
        mod_nic.get(t, {
            mac: d.mac,
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'nic not found'
            }
        });
    }
};


exports['primary uniqueness'] = {
    'create first nic': function (t) {
        d = {};
        d.macs = [ h.randomMAC(), h.randomMAC() ];
        d.owner = mod_uuid.v4();
        d.zone = mod_uuid.v4();
        d.params = {
            belongs_to_type: 'zone',
            belongs_to_uuid: d.zone,
            mac: d.macs[0],
            owner_uuid: d.owner,
            primary: true
        };

        mod_nic.createAndGet(t, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            }
        });
    },

    'create second nic with primary=true': function (t) {
        d.params.mac = d.macs[1];
        mod_nic.createAndGet(t, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            }
        });
    },

    'first nic should have primary set to false': function (t) {
        mod_nic.get(t, {
            mac: d.macs[0],
            partialExp: {
                primary: false
            }
        });
    },

    'update first nic to set primary=true': function (t) {
        mod_nic.updateAndGet(t, {
            mac: d.macs[0],
            params: {
                primary: true
            },
            partialExp: {
                primary: true
            }
        });
    },

    'second nic should have primary set to false': function (t) {
        mod_nic.get(t, {
            mac: d.macs[1],
            partialExp: {
                primary: false
            }
        });
    }
};



// XXX: More tests:
// - create nic with IP, then create another nic with the same IP.  Old nic
//   should no longer have that IP
// - should not allow updating an IP to outside the subnet (if only the IP
//   is specified)



// --- Teardown



exports['Stop server'] = function (t) {
    h.stopServer(function (err) {
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
