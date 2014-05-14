/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
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
var runOne;
var ADMIN_NET;
var NAPI;
var NET;
var NET2;
var NET3;
var PROV_MAC_NET;



// --- Helpers



function getMorayNic(t, macAddr) {
    var macNum = util_mac.aton(macAddr);
    t.ok(macNum, 'mac number');
    var morayObj = h.morayBuckets()['napi_nics'][macNum];

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
                }),
                    function (err2, res2) {
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



exports['Create nic - missing params'] = function (t) {
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
            status: 'running',
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
        }, 'result');

        return t.done();
    });
};


exports['Provision nic: exceed MAC retries'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    // One null error so that we can provision an IP
    var errs = [ null ];
    for (var i = 0; i < constants.MAC_RETRIES + 1; i++) {
        var fakeErr = new Error('Already exists');
        fakeErr.name = 'EtagConflictError';
        errs.push(fakeErr);
    }
    h.setMorayErrors({ putObject: errs });

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
            t.ok(ipRec, 'IP record exists in moray');
            if (ipRec) {
                t.equal(ipRec.reserved, false, 'IP is not reserved');
            }

            return t.done();
        });
    });
};


exports['Provision nic: retry'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    var fakeErr = new Error('Already exists');
    fakeErr.name = 'EtagConflictError';
    // One null error so that we can provision an IP
    h.setMorayErrors({ putObject: [ null, fakeErr, fakeErr ] });

    NAPI.provisionNic(PROV_MAC_NET.uuid, params, function (err, res) {
        if (h.ifErr(t, err, 'provision nic with retry')) {
            return t.done();
        }

        t.ok(res.mac, 'MAC address');
        var macNum = util_mac.aton(res.mac);
        var morayObj = h.morayBuckets()['napi_nics'][macNum];
        t.ok(morayObj, 'found moray object');
        t.equal(morayObj.mac, macNum, 'correct mac in moray object');

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
            routes: NET2.routes,
            status: 'running',
            vlan_id: NET2.vlan_id
        }, 'result');

        return t.done();
    });
};


exports['Create nic - empty nic_tags_provided'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        nic_tags_provided: '',
        owner_uuid: mod_uuid.v4()
    };

    NAPI.createNic(h.randomMAC(), params, function (err, res) {
        if (h.ifErr(t, err, 'create nic with empty nic_tags_provided')) {
            return t.done();
        }

        delete params.nic_tags_provided;
        params.primary = false;
        params.status = 'running';
        t.deepEqual(res, params, 'response');

        NAPI.getNic(res.mac, function (err2, res2) {
            t.ifError(err2);
            t.deepEqual(res2, params, 'get response');
            return t.done();
        });

    });
};


exports['Provision nic - with different status'] = function (t) {
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4(),
        status: 'incomplete'
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
            status: 'incomplete',
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



exports['Update nic - add IP'] = function (t) {
    var mac = h.randomMAC();
    var nic;
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };

    vasync.pipeline({ funcs: [
    function (_, cb) {
        NAPI.createNic(mac, params, function (err, res) {
            if (h.ifErr(t, err, 'create nic')) {
                return cb(err);
            }

            for (var p in params) {
                t.equal(res[p], params[p], p + ' correct');
            }

            return cb();
        });

    }, function (_, cb) {
        NAPI.updateNic(mac, { network_uuid: NET3.uuid }, function (err2, res2) {
            if (h.ifErr(t, err2, 'update nic')) {
                return cb(err2);
            }

            t.deepEqual(res2, {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: NET3.provision_start_ip,
                mac: res2.mac,
                netmask: '255.255.255.0',
                network_uuid: NET3.uuid,
                nic_tag: NET3.nic_tag,
                owner_uuid: params.owner_uuid,
                primary: false,
                resolvers: NET3.resolvers,
                status: 'running',
                vlan_id: NET3.vlan_id
            }, 'result');
            nic = res2;

            return cb();
        });

    }, function (_, cb) {
        NAPI.getIP(NET3.uuid, nic.ip, function (err, res) {
            if (h.ifErr(t, err, 'get IP')) {
                return cb(err);
            }

            t.deepEqual(res, {
                belongs_to_type: nic.belongs_to_type,
                belongs_to_uuid: nic.belongs_to_uuid,
                free: false,
                ip: nic.ip,
                network_uuid: NET3.uuid,
                owner_uuid: nic.owner_uuid,
                reserved: false
            }, 'get IP after update');

            return cb();
        });
    }

    ] }, function () {
        return t.done();
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
    var mac = h.randomMAC();
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
        status: 'running',
        vlan_id: NET.vlan_id
    };

    vasync.pipeline({
        funcs: [
        function (_, cb) {
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

        function (_, cb) {
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

        function (_, cb) {
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

        function (_, cb) {
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
                    network_uuid: NET.uuid,
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


exports['Update nic - change IP'] = function (t) {
    var ip1 = '10.0.2.196';
    var ip2 = '10.0.2.197';
    var ip3 = '10.0.2.198';
    var expIP1, expIP2, expIP3;

    var other = mod_uuid.v4();
    var params = {
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        ip: ip1,
        network_uuid: NET.uuid,
        owner_uuid:  mod_uuid.v4()
    };
    var mac = h.randomMAC();
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
        status: 'running',
        vlan_id: NET.vlan_id
    };

    vasync.pipeline({
    funcs: [
    function (_, cb) {
        NAPI.createNic(mac, params, function (err, res) {
            if (h.ifErr(t, err, 'create nic')) {
                return cb(err);
            }

            t.deepEqual(res, exp, 'create nic result');
            return cb();
        });
    },

    function (_, cb) {
        var updateParams = {
            ip: ip2,
            network_uuid: NET.uuid
        };

        for (var k in updateParams) {
            exp[k] = updateParams[k];
        }

        NAPI.updateNic(mac, updateParams, function (err, res) {
            if (h.ifErr(t, err, 'update nic')) {
                return cb(err);
            }

            t.deepEqual(res, exp, 'result after update');
            return cb();
        });
    },

    function (_, cb) {
        NAPI.getNic(mac, function (err, res) {
            if (h.ifErr(t, err, 'get nic')) {
                return cb(err);
            }

            t.deepEqual(res, exp, 'get nic after update');
            return cb();
        });
    },

    function (_, cb) {
        expIP1 = {
            free: true,
            ip: ip1,
            network_uuid: NET.uuid,
            reserved: false
        };

        NAPI.getIP(NET.uuid, ip1, function (err, res) {
            if (h.ifErr(t, err, 'get old IP')) {
                return cb(err);
            }

            t.deepEqual(res, expIP1, 'old IP after update');
            return cb();
        });
    },

    function (_, cb) {
        expIP2 = {
            belongs_to_type: exp.belongs_to_type,
            belongs_to_uuid: exp.belongs_to_uuid,
            free: false,
            ip: ip2,
            network_uuid: NET.uuid,
            owner_uuid: exp.owner_uuid,
            reserved: false
        };

        NAPI.getIP(NET.uuid, ip2, function (err, res) {
            if (h.ifErr(t, err, 'get new IP')) {
                return cb(err);
            }

            t.deepEqual(res, expIP2, 'new IP after update');
            return cb();
        });
    },

    // Reserve ip3 so that it exists in moray
    function (_, cb) {
        NAPI.updateIP(NET.uuid, ip3, { reserved: true },
            function (err, res) {
            if (h.ifErr(t, err, 'update ip3')) {
                return cb(err);
            }

            t.equal(res.reserved, true, 'set reserved');
            t.equal(res.free, false, 'free updated');

            return cb();
        });
    },

    // Change belongs_to_uuid of ip2: the next update should leave it
    // alone, since the nic no longer owns it
    function (_, cb) {
        NAPI.updateIP(NET.uuid, ip2, { belongs_to_uuid: other },
            function (err, res) {
            if (h.ifErr(t, err, 'update ip2: 1')) {
                return cb(err);
            }

            expIP2.belongs_to_uuid = other;
            t.deepEqual(res, expIP2, 'belongs_to_uuid changed');

            return cb();
        });
    },

    // confirm the change
    function (_, cb) {
        NAPI.getIP(NET.uuid, ip2, function (err, res) {
            if (h.ifErr(t, err, 'get: ip2')) {
                return cb(err);
            }

            t.deepEqual(res, expIP2, 'ip2: belongs_to_uuid changed');
            return cb();
        });
    },

    // Now update the nic so that it points to ip3
    function (_, cb) {
        var updateParams = {
            ip: ip3,
            network_uuid: NET.uuid
        };

        for (var k in updateParams) {
            exp[k] = updateParams[k];
        }

        NAPI.updateNic(mac, updateParams, function (err, res) {
            if (h.ifErr(t, err, 'update nic: 2')) {
                return cb(err);
            }

            t.deepEqual(res, exp, 'result after update');
            return cb();
        });
    },

    // ip1 should be unchanged
    function (_, cb) {
        NAPI.getIP(NET.uuid, ip1, function (err, res) {
            if (h.ifErr(t, err, 'get: ip1')) {
                return cb(err);
            }

            t.deepEqual(res, expIP1, 'ip1 unchanged');
            return cb();
        });
    },

    // ip2 should be unchanged as well, since it's no longer owned
    // by the nic we updated
    function (_, cb) {
        NAPI.getIP(NET.uuid, ip2, function (err, res) {
            if (h.ifErr(t, err, 'get: ip2')) {
                return cb(err);
            }

            t.deepEqual(res, expIP2, 'ip2 unchanged');
            return cb();
        });
    },

    // And finally, ip3 should have the nic as its owner now and still have
    // reserved set to true
    function (_, cb) {
        expIP3 = {
            belongs_to_type: exp.belongs_to_type,
            belongs_to_uuid: exp.belongs_to_uuid,
            free: false,
            ip: ip3,
            network_uuid: NET.uuid,
            owner_uuid: exp.owner_uuid,
            reserved: true
        };

        NAPI.getIP(NET.uuid, ip3, function (err, res) {
            if (h.ifErr(t, err, 'get: ip3')) {
                return cb(err);
            }

            t.deepEqual(res, expIP3, 'ip3 unchanged');
            return cb();
        });
    }

    ] }, function () {
        return t.done();
    });
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


exports['Update nic - same params'] = function (t) {
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

        NAPI.updateNic(res.mac, res, function (err2, res2) {
            if (h.ifErr(t, err2, 'update nic')) {
                return t.done();
            }

            t.deepEqual(res2, res, 'Nic parameters unchanged');

            return t.done();
        });
    });
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
        res.status = 'installed';

        NAPI.updateNic(res.mac, res, function (err2, res2) {
            if (h.ifErr(t, err2, 'update nic')) {
                return t.done();
            }

            t.deepEqual(res2, res, 'Status changed to installed');

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


exports['antispoof options'] = function (t) {
    var nic;
    var params = {
        allow_dhcp_spoofing: true,
        allow_ip_spoofing: true,
        allow_mac_spoofing: true,
        allow_restricted_traffic: true,
        allow_unfiltered_promisc: true,
        belongs_to_type: 'zone',
        belongs_to_uuid: mod_uuid.v4(),
        owner_uuid:  mod_uuid.v4()
    };
    var updateParams = {
        allow_dhcp_spoofing: false,
        allow_ip_spoofing: false,
        allow_mac_spoofing: false,
        allow_restricted_traffic: false,
        allow_unfiltered_promisc: false
    };

    vasync.pipeline({ funcs: [
    function (_, cb) {
        NAPI.provisionNic(NET2.uuid, params, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            for (var p in params) {
                t.equal(res[p], params[p], p + ' correct (provision)');
            }
            t.equal(res.ip, h.nextProvisionableIP(NET2), 'IP');
            nic = res;

            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            return cb();
        });

    }, function (_, cb) {
        NAPI.getNic(nic.mac, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            for (var p in params) {
                t.equal(res[p], params[p], p + ' correct (first get)');
            }

            return cb();
        });

    }, function (_, cb) {
        // Disable the antispoof options
        NAPI.updateNic(nic.mac, updateParams, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            // Confirm that the fields have been removed from moray
            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            for (var p in updateParams) {
                t.ok(!res.hasOwnProperty(p),
                    p + ' does not exist (update to false)');

                t.ok(!morayObj.hasOwnProperty(p),
                    p + ' not in moray object (update to false)');
            }
            nic = res;

            return cb();
        });

    }, function (_, cb) {
        NAPI.getNic(nic.mac, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            for (var p in updateParams) {
                t.ok(!res.hasOwnProperty(p),
                    p + ' does not exist (second get)');
            }

            return cb();
        });

    }, function (_, cb) {
        var p;
        // Re-enable the antispoof options
        for (p in updateParams) {
            updateParams[p] = true;
        }

        NAPI.updateNic(nic.mac, updateParams, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            // Confirm that the fields have been removed from moray
            var morayObj = getMorayNic(t, res.mac);
            t.ok(!morayObj.hasOwnProperty('network'),
                'moray object does not have network in it');

            for (p in updateParams) {
                t.ok(res[p], p + ' in res (update to true)');

                t.ok(morayObj.hasOwnProperty(p),
                    p + ' in moray object (update to true)');
            }
            nic = res;

            return cb();
        });

    }, function (_, cb) {
        NAPI.getNic(nic.mac, function (err, res) {
            t.ifError(err);
            if (err) {
                return cb(err);
            }

            for (var p in updateParams) {
                t.ok(res[p], p + ' is true (third get)');
            }

            return cb();
        });
    }

    ] }, function () {
        return t.done();
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
