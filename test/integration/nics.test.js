/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Integration tests for /nics and /networks/:uuid/nics endpoints
 */

'use strict';

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_net = require('../lib/net');
var mod_nic = require('../lib/nic');
var mod_uuid = require('node-uuid');
var test = require('tape');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var napi = h.createNAPIclient();
var state = {
    nic: {},
    ip: {},
    desc: {},
    mac: {}
};
var uuids = {
    admin: '',
    a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2',
    b: '91abd897-566a-4ae5-80d2-1ba103221bbc',
    c: 'e8e2deb9-2d68-4e4e-9aa6-4962c879d9b1',
    d: mod_uuid.v4()
};



// --- Setup



test('setup', function (t) {
    t.test('create nic tags', function (t2) {
        h.createNicTags(t2, napi, state, [
            'nicTag', 'nicTag2', 'nicTag3', 'nicTag4', 'nicTag5'
        ]);
    });

    t.test('create network', function (t2) {
        // "TEST-NET-2" in RFC 5737:
        var net = h.validNetworkParams({
            gateway: '198.51.100.4',
            nic_tag: state.nicTag.name,
            provision_end_ip: '198.51.100.250',
            provision_start_ip: '198.51.100.5',
            resolvers: [ '8.8.8.8' ],
            subnet: '198.51.100.0/24'
        });

        mod_net.create(t2, {
            fillInMissing: true,
            params: net,
            exp: net,
            state: state
        });
    });
});


test('load UFDS admin UUID', function (t) {
    h.loadUFDSadminUUID(t, function (adminUUID) {
        if (adminUUID) {
            uuids.admin = adminUUID;
        }

        return t.end();
    });
});



// --- Tests



test('POST /nics (basic)', function (t) {
    var desc = 'basic: no IP';
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, h.reqOpts(t, desc), function (err, res) {
        desc = util.format(' [%s: : %s]', mac, desc);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        params.mac = mac;
        mod_nic.addDefaultParams(params);
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.a = params;
        state.desc.a = desc;

        return t.end();
    });
});


test('POST /nics (with IP, network and state)', function (t) {
    var d = {};

    t.test('create', function (t2) {
        var desc = 'with IP and network';
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server',
            ip: '198.51.100.77',
            network_uuid: state.networks[0].uuid,
            state: 'provisioning'
        };
        d.mac = h.randomMAC();

        napi.createNic(d.mac, params, h.reqOpts(t, desc), function (err, res) {
            desc = util.format(' [%s: %s]', d.mac, desc);
            t2.ifError(err, 'provision nic' + desc);
            if (err) {
                return t2.end();
            }

            params.mac = d.mac;
            mod_nic.addDefaultParams(params, state.networks[0]);
            t2.deepEqual(res, params, 'nic params returned' + desc);
            state.nic.b = params;
            state.desc.b = desc;
            state.ip.b = params.ip;
            state.mac.b = d.mac;

            return t2.end();
        });
    });

    t.test('with duplicate MAC', function (t2) {
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: mod_uuid.v4(),
            belongs_to_type: 'server'
        };

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            expErr: h.invalidParamErr({ errors: [
                mod_err.duplicateParam('mac', mod_err.msg.duplicate)
            ]})
        });
    });
});

test('Network deletion with active NIC fails', function (t) {
    var mac = state.mac.b;
    napi.deleteNetwork(state.networks[0].uuid, function (err) {
        t.deepEqual(err.body, {
            'code': 'InUse',
            'message': 'network must have no NICs provisioned',
            'errors': [
                {
                    'type': 'nic',
                    'id': mac,
                    'code': 'UsedBy',
                    'message': 'In use by nic "' + mac + '"'
                }
            ]
        }, 'Error is correct');
        return t.end();
    });
});


test('POST /nics (with IP but no network)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        ip: '198.51.100.79',
        nic_tag: state.networks[0].nic_tag,
        vlan_id: state.networks[0].vlan_id,
        nic_tags_provided: [ 'external' ]
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with IP but no network]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        params.mac = mac;
        mod_nic.addDefaultParams(params, state.networks[0]);
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.c = params;
        state.desc.c = desc;
        state.ip.c = params.ip;

        return t.end();
    });
});


test('POST /nics (with IP already reserved)', function (t) {
    var d = {};

    t.test('create with gateway IP', function (t2) {
        d.params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server',
            ip: state.networks[0].gateway,
            nic_tag: state.networks[0].nic_tag,
            vlan_id: state.networks[0].vlan_id
        };

        mod_nic.create(t2, {
            mac: h.randomMAC(),
            params: d.params,
            partialExp: d.params,
            state: state
        });
    });

    t.test('reserve IP', function (t2) {
        d.params.ip = '198.51.100.252';
        napi.updateIP(state.networks[0].uuid, d.params.ip, { reserved: true },
            function (err, res) {
            if (h.ifErr(t2, err, 'update IP ' + d.params.ip)) {
                return t2.end();
            }

            t2.ok(res.reserved, 'IP reserved');
            return t2.end();
        });
    });

    t.test('get IP after reservation', function (t2) {
        napi.getIP(state.networks[0].uuid, d.params.ip, function (err, res) {
            if (h.ifErr(t2, err, 'update IP ' + d.params.ip)) {
                return t2.end();
            }

            t2.ok(res.reserved, 'IP reserved');
            return t2.end();
        });
    });

    t.test('create', function (t2) {
        var mac = h.randomMAC();
        d.desc = util.format(' [%s: with IP already reserved]', mac);

        var client = h.createNAPIclient(t2);
        client.createNic(mac, d.params, function (err, res) {
            if (h.ifErr(t2, err, 'provision nic' + d.desc)) {
                return t2.end();
            }

            d.params.mac = mac;
            mod_nic.addDefaultParams(d.params, state.networks[0]);
            t2.deepEqual(res, d.params, 'nic params returned' + d.desc);
            state.resNic1 = d.params;
            state.desc.resNic1 = d.desc;

            return t2.end();
        });
    });

    t.test('get', function (t2) {
        napi.getIP(state.networks[0].uuid, d.params.ip, function (err2, res2) {
            if (h.ifErr(t2, err2, 'get IP ' + d.params.ip + d.desc)) {
                return t2.end();
            }

            var exp = {
                belongs_to_type: d.params.belongs_to_type,
                belongs_to_uuid: d.params.belongs_to_uuid,
                ip: d.params.ip,
                network_uuid: state.networks[0].uuid,
                owner_uuid: d.params.owner_uuid,
                reserved: true,
                free: false
            };
            t2.deepEqual(res2, exp,
                'IP params correct: ' + d.params.ip + d.desc);

            return t2.end();
        });
    });

    t.test('create with same IP', function (t2) {
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: '144b27d7-578d-4326-b7df-98065071e0ab',
            belongs_to_type: 'server',
            ip: d.params.ip,
            nic_tag: state.networks[0].nic_tag,
            vlan_id: state.networks[0].vlan_id
        };
        var mac = h.randomMAC();

        mod_nic.create(t2, {
            mac: mac,
            params: params,
            expErr: h.invalidParamErr({ errors: [
                mod_err.usedByParam('ip', d.params.belongs_to_type,
                    d.params.belongs_to_uuid,
                    util.format(constants.fmt.IP_IN_USE,
                        d.params.belongs_to_type, d.params.belongs_to_uuid))
            ]})
        });
    });

    t.test('create second nic with no IP', function (t2) {
        d.mac = h.randomMAC();
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server'
        };

        mod_nic.create(t2, {
            mac: d.mac,
            params: params,
            partialExp: params,
            state: state
        });
    });

    t.test('update second nic to same IP', function (t2) {
        mod_nic.update(t2, {
            mac: d.mac,
            params: {
                ip: d.params.ip,
                network_uuid: state.networks[0].uuid
            },
            expErr: h.invalidParamErr({ errors: [
                mod_err.duplicateParam('ip', util.format(
                    constants.fmt.IP_EXISTS, state.networks[0].uuid))
            ] })
        });
    });
});


test('POST /networks/:uuid/nics (basic)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    napi.provisionNic(state.networks[0].uuid, params, function (err, res) {
        if (err) {
            return h.doneWithError(t, err,
                'provision nic [network nic - no IP]');
        }
        var desc = util.format(' [%s: network nic - no IP]', res.mac);

        params.mac = res.mac;
        params.ip = res.ip;
        mod_nic.addDefaultParams(params, state.networks[0]);

        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.d = params;
        state.desc.d = desc;
        state.ip.d = params.ip;
        return t.end();
    });
});


test('POST /networks/:uuid/nics (with IP)', function (t) {
    var desc = 'network nic - with IP';
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        ip: '198.51.100.201'
    };

    napi.provisionNic(state.networks[0].uuid, params, h.reqOpts(t, desc),
            function (err, res) {
        t.ifError(err, 'provision nic [network nic - with IP]');
        if (err) {
            return t.end();
        }
        desc = util.format(' [%s: %s]', res.mac, desc);

        params.mac = res.mac;
        mod_nic.addDefaultParams(params, state.networks[0]);

        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.e = params;
        state.desc.e = desc;
        state.ip.e = params.ip;
        return t.end();
    });
});


test('Check IPs are created along with nics', function (t) {
    var ips = ['b', 'c', 'd', 'e'];

    function checkIP(ipNum, cb) {
        var ip = state.ip[ipNum];
        napi.getIP(state.networks[0].uuid, ip, function (err, res) {
            var desc = util.format(' %s/%s%s',
                state.networks[0].uuid, ip, state.desc[ipNum]);
            t.ifError(err, 'get IP' + desc);
            if (err) {
                return cb();
            }

            var exp = {
                belongs_to_type: 'server',
                belongs_to_uuid: uuids.a,
                ip: ip,
                network_uuid: state.networks[0].uuid,
                owner_uuid: uuids.b,
                reserved: false,
                free: false
            };
            t.deepEqual(res, exp, 'IP params correct' + desc);
            return cb();
        });
    }

    vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        t.ifError(err, 'getting IPs should succeed');
        t.end();
    });
});


test('POST /nics (with reserved IP)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        network_uuid: state.networks[0].uuid,
        reserved: true
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with reserved IP]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        delete params.reserved;
        params.mac = mac;
        params.ip = res.ip;
        mod_nic.addDefaultParams(params, state.networks[0]);
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.resNic2 = res;
        state.desc.resNic2 = desc;

        // IP should be reserved
        return napi.getIP(state.networks[0].uuid, params.ip,
                function (err2, res2) {
            t.ifError(err2, 'get IP ' + params.ip + desc);
            if (err2) {
                return t.end();
            }

            var exp = {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: params.ip,
                network_uuid: state.networks[0].uuid,
                owner_uuid: params.owner_uuid,
                reserved: true,
                free: false
            };
            t.deepEqual(res2, exp, 'IP params correct: ' + params.ip + desc);

            return t.end();
        });
    });
});


test('POST /nics (with model)', function (t) {
    var desc;
    var mac = h.randomMAC();
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        model: 'virtio'
    };

    vasync.pipeline({
    funcs: [
        function (_, cb) {
            napi.createNic(mac, params, function (err, res) {
                desc = util.format(' [%s: with model]', mac);
                t.ifError(err, 'provision nic' + desc);
                if (err) {
                    return t.end();
                }

                params.primary = false;
                params.mac = mac;
                params.state = constants.DEFAULT_NIC_STATE;
                t.deepEqual(res, params, 'nic params returned' + desc);
                state.nic.model = params;
                state.desc.model = desc;

                return cb();
            });

        }, function (_, cb) {
            napi.getNic(mac, function (err, res) {
                t.ifError(err, 'get nic' + desc);
                if (err) {
                    return cb(err);
                }

                t.deepEqual(res, params, 'nic params returned' + desc);
                return cb();
            });

        }, function (_, cb) {
            napi.updateNic(mac, { model: 'e1000' }, function (err, res) {
                t.ifError(err, 'update nic' + desc);
                if (err) {
                    return t.end();
                }

                params.model = 'e1000';
                t.deepEqual(res, params, 'updated nic params returned' + desc);
                return cb();
            });

        }, function (_, cb) {
            napi.getNic(mac, function (err, res) {
                t.ifError(err, 'get nic' + desc);
                if (err) {
                    return cb(err);
                }

                t.deepEqual(res, params, 'nic params returned' + desc);
                return cb();
            });
        }
    ]}, function () {
        return t.end();
    });
});


test('POST /nics (duplicate nic)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();
    var desc = util.format(' [%s: duplicate nic]', mac);

    napi.createNic(mac, params, function (err, res) {
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        params.primary = false;
        t.equal(res.mac, mac, 'mac correct');

        napi.createNic(mac, params, function (err2) {
            t.ok(err2, 'error creating duplicate nic');
            if (!err2) {
                return t.end();
            }

            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('mac') ]
            }), 'Error body');

            return t.end();
        });
    });
});


test('DELETE /nics/:mac (with reserved IP)', function (t) {
    function delNic(name, cb) {
        var nic = state[name];
        var desc = state.desc[name];

        napi.deleteNic(nic.mac, function (err) {
            if (h.ifErr(t, err, 'delete nic' + desc)) {
                return cb(err);
            }

            napi.getIP(state.networks[0].uuid, nic.ip, function (err2, res2) {
                if (h.ifErr(t, err2, 'get IP' + nic.ip + desc)) {
                    return cb();
                }

                // A reserved IP should keep its owner information
                var exp = {
                    free: false,
                    ip: nic.ip,
                    network_uuid: state.networks[0].uuid,
                    owner_uuid: nic.owner_uuid,
                    reserved: true
                };
                t.deepEqual(res2, exp, 'IP params correct: ' + nic.ip
                    + desc);

                return cb();
            });
        });
    }

    vasync.forEachParallel({
        func: delNic,
        inputs: ['resNic1', 'resNic2']
    }, function (err) {
        t.ifError(err, 'deleting NICs should succeed');
        t.end();
    });
});


test('GET /nics/:mac', function (t) {
    var nics = ['a', 'b', 'c', 'd', 'e'];

    function checkNic(nicNum, cb) {
        var nic = state.nic[nicNum];
        var desc = state.desc[nicNum];
        napi.getNic(nic.mac, h.reqOpts(t, desc), function (err, res) {
            t.ifError(err, 'get nic' + desc);
            if (err) {
                return cb(err);
            }
            t.deepEqual(res, nic, 'get params' + desc);
            return cb();
        });
    }

    vasync.forEachParallel({
        func: checkNic,
        inputs: nics
    }, function (err) {
        t.ifError(err, 'getting NICs should succeed');
        t.end();
    });
});


test('PUT /nics/:mac', function (t) {
    var nics = ['a', 'b', 'd'];
    var params = {
        owner_uuid: uuids.c,
        belongs_to_uuid: uuids.d,
        belongs_to_type: 'other',
        nic_tags_provided: [ state.nicTag.name ]
    };

    function updateNic(nicNum, cb) {
        var client = h.createNAPIclient(t);
        var desc = ' update ' + state.desc[nicNum] + ' req_id=' + client.req_id;
        var nic = state.nic[nicNum];

        client.updateNic(nic.mac, params, function (err, res) {
            h.ifErr(t, err, desc);

            for (var p in params) {
                nic[p] = params[p];
            }
            t.deepEqual(res, nic, 'params' + desc);

            client.getNic(nic.mac, function (err2, res2) {
                h.ifErr(t, err2, 'get' + desc);
                t.deepEqual(res2, nic, 'get params' + desc);

                return cb();
            });
        });
    }

    vasync.forEachParallel({
        func: updateNic,
        inputs: nics
    }, function (err) {
        t.ifError(err, 'updating NICs should succeed');
        t.end();
    });
});


test('Check IPs are updated along with nics', function (t) {
    var ips = ['b', 'd'];

    var checkIP = function (ipNum, cb) {
        var ip = state.ip[ipNum];
        var desc = util.format(' %s/%s%s',
            state.networks[0].uuid, ip, state.desc[ipNum]);
        napi.getIP(state.networks[0].uuid, ip, function (err, res) {
            t.ifError(err, 'get updated IP' + desc);
            if (err) {
                return cb();
            }

            var exp = {
                belongs_to_uuid: uuids.d,
                belongs_to_type: 'other',
                ip: ip,
                network_uuid: state.networks[0].uuid,
                owner_uuid: uuids.c,
                reserved: false,
                free: false
            };
            t.deepEqual(res, exp, 'Updated IP params correct' + desc);
            return cb();
        });
    };

    vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        t.ifError(err, 'getting IPs should succeed');
        t.end();
    });
});


test('PUT /nics (with network_uuid and state)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with network_uuid]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        state.nic.putIPnetUUID = params;
        state.desc.putIPnetUUID = desc;

        var updateParams = {
            network_uuid: state.networks[0].uuid,
            state: 'stopped'
        };
        napi.updateNic(mac, updateParams, function (err2, res2) {
            t.ifError(err2, 'update nic' + desc);
            if (err2) {
                return t.end();
            }

            params.mac = mac;
            params.ip = res2.ip;
            params.state = 'stopped';
            mod_nic.addDefaultParams(params, state.networks[0]);
            t.ok(res2.ip, 'nic now has IP address');
            t.deepEqual(res2, params, 'nic params returned' + desc);
            state.nic.putIPnetUUID = params;
            state.ip.putIPnetUUID = res2.ip;

            if (!res2.ip || !state.networks[0].uuid) {
                t.ok(false, util.format(
                    'Not all params present: ip=%s, network_uuid=%s', res2.ip,
                    state.networks[0].uuid));
                return t.end();
            }

            napi.getIP(state.networks[0].uuid, res2.ip, function (err3, res3) {
                t.ifError(err3, 'get IP' + desc);
                if (err) {
                    return t.end();
                }

                var exp = {
                    belongs_to_type: 'server',
                    belongs_to_uuid: uuids.a,
                    ip: res2.ip,
                    network_uuid: state.networks[0].uuid,
                    owner_uuid: uuids.b,
                    reserved: false,
                    free: false
                };
                t.deepEqual(res3, exp, 'IP params correct' + desc);

                return t.end();
            });
        });
    });
});


test('GET /networks/admin', function (t) {
    napi.getNetwork('admin', function (err, res) {
        t.ifError(err, 'get admin network');
        if (err) {
            return t.end();
        }

        t.equal(res.name, 'admin', 'admin network found');
        state.adminNet = res;
        return t.end();
    });
});


// Note that this is the only test in this entire suite that affects
// networks used in production. This functionality is absolutely
// necessary for booter, so we should still make sure to test it
test('PUT /nics (with network_uuid set to admin)', function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with network_uuid set to admin]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            t.deepEqual(err.body, {}, 'error body for debugging');
            return t.end();
        }

        state.nic.putIPwithName = params;
        state.desc.putIPwithName = desc;

        var updateParams = {
            network_uuid: 'admin',
            owner_uuid: uuids.admin
        };
        napi.updateNic(mac, updateParams, function (err2, res2) {
            t.ifError(err2, 'update nic' + desc);
            if (err2) {
                t.deepEqual(err2.body, {}, 'error body for debugging');
                return t.end();
            }

            params.mac = mac;
            params.ip = res2.ip;
            params.owner_uuid = updateParams.owner_uuid;
            mod_nic.addDefaultParams(params, state.adminNet);

            t.deepEqual(res2, params, 'nic params returned' + desc);
            state.nic.putIPwithName = params;
            state.ip.putIPwithName = res2.ip;

            napi.getIP(state.adminNet.uuid, res2.ip, function (err3, res3) {
                t.ifError(err3, 'get IP' + desc);
                if (err) {
                    return t.end();
                }

                var exp = {
                    belongs_to_type: 'server',
                    belongs_to_uuid: uuids.a,
                    ip: res2.ip,
                    network_uuid: state.adminNet.uuid,
                    owner_uuid: updateParams.owner_uuid,
                    reserved: false,
                    free: false
                };
                t.deepEqual(res3, exp, 'IP params correct' + desc);

                return t.end();
            });
        });
    });
});


test('primary uniqueness', function (t) {
    var d = {};

    t.test('create first nic', function (t2) {
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

        mod_nic.createAndGet(t2, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            },
            state: state
        });
    });

    t.test('create second nic with primary=true', function (t2) {
        d.params.mac = d.macs[1];
        mod_nic.createAndGet(t2, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            },
            state: state
        });
    });

    t.test('first nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[0],
            partialExp: {
                primary: false
            }
        });
    });

    t.test('update first nic to set primary=true', function (t2) {
        mod_nic.updateAndGet(t2, {
            mac: d.macs[0],
            params: {
                primary: true
            },
            partialExp: {
                primary: true
            }
        });
    });

    t.test('second nic should have primary set to false', function (t2) {
        mod_nic.get(t2, {
            mac: d.macs[1],
            partialExp: {
                primary: false
            }
        });
    });
});


test('PUT /nics (with network_uuid set to invalid name)', function (t) {
    // Only network_uuid=admin is allowed
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with network_uuid set to name]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.end();
        }

        state.nic.putIPwithInvalidName = params;
        state.desc.putIPwithInvalidName = desc;

        var updateParams = { network_uuid: state.networks[0].name };
        napi.updateNic(mac, updateParams, function (err2, res2) {
            t.ok(err2, 'expected error');
            if (!err2) {
                return t.end();
            }

            // XXX: we end up with a stringified JSON object here, which is
            // definitely a bug somewhere.
            t.notEqual(err2.message,
                util.format('Unknown network "%s"', state.networks[0].name),
                'Error message correct');
            return t.end();
        });
    });
});


test('GET /nics (filtered by belongs_to_uuid)', function (t) {
    var filter = { belongs_to_uuid: uuids.d };
    var nics = ['a', 'b', 'd'].reduce(function (r, n) {
        r[state.nic[n].mac] = n;
        return r;
    }, {});

    napi.listNics(filter, function (err, res) {
        t.ifError(err, 'get nics');

        // Since we generated this UUID at the beginning of this test, only
        // the updated nics should be in the list

        var found = 0;
        t.ok(res.length !== 0, 'nics in list');

        for (var i = 0; i < res.length; i++) {
            var cur = res[i];
            if (!nics.hasOwnProperty(cur.mac)) {
                t.ok(false, cur.mac + ' returned in list but should not be');
                continue;
            }

            var params = state.nic[nics[cur.mac]];
            var desc = state.desc[nics[cur.mac]];
            t.deepEqual(cur, params, 'list nic matches' + desc);
            found++;
        }

        t.equal(found, res.length, 'all nics found in list');
        return t.end();
    });
});


test('GET /nics (filtered)', function (t) {
    var filters = [
        { belongs_to_type: 'other', network_uuid: state.networks[0].uuid },
        { owner_uuid: uuids.b, network_uuid: state.networks[0].uuid },
        { nic_tag: state.nicTag.name }
    ];

    function listNics(filter, cb) {
        napi.listNics(filter, function (err, res) {
            t.ifError(err, 'get nics: ' + JSON.stringify(filter));

            t.ok(res.length !== 0, 'nics in list: ' + JSON.stringify(filter));

            for (var i = 0; i < res.length; i++) {
                var cur = res[i];
                for (var f in filter) {
                    if (cur[f] !== filter[f]) {
                        t.equal(cur[f], filter[f], util.format('nic "%s" ' +
                            'does not match filter %s=%s: %j',
                            cur.mac, f, filter[f], cur));
                        return cb();
                    }
                }
            }

            return cb();
        });
    }

    vasync.forEachParallel({
        func: listNics,
        inputs: filters
    }, function (err) {
        t.ifError(err, 'listing nics should succeed');
        t.end();
    });
});


test('POST /nics (nic_tags_provided)', function (t) {
    var params1 = {
        owner_uuid: uuids.b,
        belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
        belongs_to_type: 'server',
        nic_tags_provided: [state.nicTag2.name]
    };
    var params2 = {
        owner_uuid: uuids.b,
        belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
        belongs_to_type: 'server',
        nic_tags_provided: [state.nicTag3.name]
    };

    napi.createNic(h.randomMAC(), params1, function (err, res) {
        t.ifError(err, 'create nic 1');
        if (err) {
            return t.end();
        }

        state.nic.f = res;
        state.desc.f = util.format(' [%s: nic_tags_provided nic 1]', res.mac);
        t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
            'nic 1 nic_tags_provided');

        napi.createNic(h.randomMAC(), params2, function (err2, res2) {
            t.ifError(err2, 'create nic 2');
            if (err2) {
                return t.end();
            }

            state.nic.g = res2;
            state.desc.g = util.format(' [%s: nic_tags_provided nic 2]',
                res2.mac);
            t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
                'nic 2 nic_tags_provided');

            return t.end();
        });
    });
});


test('POST /nics (nic_tags_provided scalar)', function (t) {
    vasync.pipeline({
        funcs: [
        function (_, cb) {
            var params1 = {
                owner_uuid: uuids.b,
                belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
                belongs_to_type: 'server',
                nic_tags_provided: util.format('%s,%s', state.nicTag4.name,
                    state.nicTag5.name)
            };

            napi.createNic(h.randomMAC(), params1, function (err, res) {
                t.ifError(err, 'create nic 1');
                if (err) {
                    return cb(err);
                }

                state.nic.ntps1 = res;
                state.desc.ntps1 = util.format(
                    ' [%s: nic_tags_provided scalar nic 1]', res.mac);
                t.deepEqual(res.nic_tags_provided, [state.nicTag4.name,
                    state.nicTag5.name], 'nic 1 nic_tags_provided');

                return cb();
            });

        }, function (_, cb) {
            var updateParams = {
                nic_tags_provided: util.format('%s,%s', state.nicTag5.name,
                    state.nicTag4.name)
            };

            napi.updateNic(state.nic.ntps1.mac, updateParams,
                function (err, res) {
                t.ifError(err, 'update nic 1');
                if (err) {
                    return cb(err);
                }

                t.deepEqual(res.nic_tags_provided, [state.nicTag5.name,
                    state.nicTag4.name], 'nic 1 nic_tags_provided');

                return cb();
            });
        }]
    }, function () {
        return t.end();
    });
});


test('GET /nics (filter: nic_tags_provided)', function (t) {
    var filter = {
        nic_tags_provided: [ state.nicTag2.name, state.nicTag3.name,
            state.nicTag5.name ]
    };

    napi.listNics(filter, function (err, res) {
        t.ifError(err, 'get nics: ' + JSON.stringify(filter));
        if (err) {
            return t.end();
        }
        t.equal(res.length, 3, '3 nics returned');

        if (res.length === 0) {
            return t.end();
        }

        var macs = res.reduce(function (arr, x) {
            arr.push(x.mac);
            return arr;
        }, []).sort();

        t.deepEqual(macs, [ state.nic.f.mac, state.nic.g.mac,
            state.nic.ntps1.mac ].sort(),
            'all three nics returned');
        return t.end();
    });
});


test('DELETE /nics/:mac', function (t) {
    var nics = Object.keys(state.nic);

    var delNic = function (nicNum, cb) {
        var nic = state.nic[nicNum];
        var desc = state.desc[nicNum] || '';

        return napi.deleteNic(nic.mac, function (err, res) {
            t.ifError(err, 'delete nic ' + nic.mac + desc);
            if (err) {
                return cb();
            }

            return napi.getNic(nic.mac, function (err2, res2) {
                t.ok(err2, 'error getting deleted nic' + desc);
                if (!err) {
                    return cb();
                }
                t.equal(err2.code, 'ResourceNotFound',
                    '404 on deleted nic' + desc);

                return cb();
            });
        });
    };

    vasync.forEachParallel({
        func: delNic,
        inputs: nics
    }, function (_err) {
        return t.end();
    });
});


test('Check IPs are freed along with nics', function (t) {
    var ips = Object.keys(state.ip);

    var checkIP = function (ipDesc, cb) {
        var ip = state.ip[ipDesc];
        var net = state.networks[0];

        if (ipDesc === 'putIPwithName') {
            net = state.adminNet;
        }

        var desc = util.format(' %s/%s%s', net.uuid, ip, state.desc[ipDesc]);

        if (!ip) {
            t.ok(false, 'IP "' + ipDesc + '" does not exist:' + desc);
            return cb();
        }

        napi.getIP(net.uuid, ip, function (err, res) {
            t.ifError(err, 'get updated IP' + desc);
            if (err) {
                t.deepEqual(net, {},
                    util.format('network for Failing IP: %s', desc));
                return cb();
            }

            var exp = {
                free: true,
                ip: ip,
                network_uuid: net.uuid,
                reserved: false
            };
            t.deepEqual(res, exp, 'Updated IP params correct' + desc);
            return cb();
        });
    };

    vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (_err) {
        return t.end();
    });
});



// --- Teardown



test('teardown', function (t) {

    t.test('delete nics', mod_nic.delAllCreated);

    t.test('delete network', mod_net.delAllCreated);

    t.test('delete nic tags', function (t2) {
        h.deleteNicTags(t2, napi, state);
    });

});
