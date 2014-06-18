/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /nics and /networks/:uuid/nics endpoints
 */

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_nic = require('../lib/nic');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');
var vasync = require('vasync');



// --- Globals



var d = {};
// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var napi = h.createNAPIclient();
var state = {
    nic: {},
    ip: {},
    desc: {}
};
var uuids = {
    admin: h.ufdsAdminUuid,
    a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2',
    b: '91abd897-566a-4ae5-80d2-1ba103221bbc',
    c: 'e8e2deb9-2d68-4e4e-9aa6-4962c879d9b1',
    d: mod_uuid.v4()
};



// --- Setup


/**
 * Call createNic, but expect an error
 */
function expCreateErr(t, mac, params, expErr) {
    var client = h.createNAPIclient(t);

    client.createNic(mac, params, function (err, res) {
        t.ok(err, 'error was returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, expErr, 'error body');
        return t.done();
    });
}



// --- Setup



exports['setup'] = function (t) {
    h.createNicTags(t, napi, state,
        ['nicTag', 'nicTag2', 'nicTag3', 'nicTag4', 'nicTag5'], function (err) {
        if (err) {
            return t.done();
        }

        h.createNetwork(t, napi, state, { gateway: '10.99.99.4' });
    });
};



// --- Tests



exports['POST /nics (basic)'] = function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: basic: no IP]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.done();
        }

        params.primary = false;
        params.mac = mac;
        params.state = 'running';
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.a = params;
        state.desc.a = desc;

        return t.done();
    });
};


exports['POST /nics (with IP, network and state)'] = {
    'create': function (t) {
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server',
            ip: '10.99.99.77',
            network_uuid: state.network.uuid,
            state: 'provisioning'
        };
        d.mac = h.randomMAC();

        napi.createNic(d.mac, params, function (err, res) {
            var desc = util.format(' [%s: with IP and network]', d.mac);
            t.ifError(err, 'provision nic' + desc);
            if (err) {
                return t.done();
            }

            params.primary = false;
            params.mac = d.mac;
            h.addNetParamsToNic(state, params);
            t.deepEqual(res, params, 'nic params returned' + desc);
            state.nic.b = params;
            state.desc.b = desc;
            state.ip.b = params.ip;

            return t.done();
        });
    },

    'with duplicate MAC': function (t) {
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: mod_uuid.v4(),
            belongs_to_type: 'server'
        };

        expCreateErr(t, d.mac, params, h.invalidParamErr({ errors: [
            mod_err.duplicateParam('mac', mod_err.msg.duplicate)
        ] }));
    }
};


exports['POST /nics (with IP but no network)'] = function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        ip: '10.99.99.79',
        nic_tag: state.network.nic_tag,
        vlan_id: state.network.vlan_id,
        nic_tags_provided: [ 'external' ]
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with IP but no network]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.done();
        }

        params.primary = false;
        params.mac = mac;
        params.state = 'running';
        h.addNetParamsToNic(state, params);
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.c = params;
        state.desc.c = desc;
        state.ip.c = params.ip;

        return t.done();
    });
};


exports['POST /nics (with IP already reserved)'] = {
    'create with gateway IP': function (t) {
        d.params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server',
            ip: state.network.gateway,
            nic_tag: state.network.nic_tag,
            vlan_id: state.network.vlan_id
        };

        mod_nic.create(t, {
            mac: h.randomMAC(),
            params: d.params,
            partialExp: d.params,
            state: state
        });
    },

    'reserve IP': function (t) {
        d.params.ip = '10.99.99.252';
        napi.updateIP(state.network.uuid, d.params.ip, { reserved: true },
            function (err, res) {
            if (h.ifErr(t, err, 'update IP ' + d.params.ip)) {
                return t.done();
            }

            t.ok(res.reserved, 'IP reserved');
            return t.done();
        });
    },

    'get IP after reservation': function (t) {
        napi.getIP(state.network.uuid, d.params.ip, function (err, res) {
            if (h.ifErr(t, err, 'update IP ' + d.params.ip)) {
                return t.done();
            }

            t.ok(res.reserved, 'IP reserved');
            return t.done();
        });
    },

    'create': function (t) {
        var mac = h.randomMAC();
        d.desc = util.format(' [%s: with IP already reserved]', mac);

        var client = h.createNAPIclient(t);
        client.createNic(mac, d.params, function (err, res) {
            if (h.ifErr(t, err, 'provision nic' + d.desc)) {
                return t.done();
            }

            d.params.primary = false;
            d.params.mac = mac;
            d.params.state = 'running';
            h.addNetParamsToNic(state, d.params);
            t.deepEqual(res, d.params, 'nic params returned' + d.desc);
            state.resNic1 = d.params;
            state.desc.resNic1 = d.desc;

            return t.done();
        });
    },

    'get': function (t) {
        napi.getIP(state.network.uuid, d.params.ip, function (err2, res2) {
            if (h.ifErr(t, err2, 'get IP ' + d.params.ip + d.desc)) {
                return t.done();
            }

            var exp = {
                belongs_to_type: d.params.belongs_to_type,
                belongs_to_uuid: d.params.belongs_to_uuid,
                ip: d.params.ip,
                network_uuid: state.network.uuid,
                owner_uuid: d.params.owner_uuid,
                reserved: true,
                free: false
            };
            t.deepEqual(res2, exp,
                'IP params correct: '+ d.params.ip + d.desc);

            return t.done();
        });
    },

    'create with same IP': function (t) {
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: '144b27d7-578d-4326-b7df-98065071e0ab',
            belongs_to_type: 'server',
            ip: d.params.ip,
            nic_tag: state.network.nic_tag,
            vlan_id: state.network.vlan_id
        };
        var mac = h.randomMAC();

        expCreateErr(t, mac, params, h.invalidParamErr({ errors: [
            mod_err.usedByParam('ip', d.params.belongs_to_type,
                d.params.belongs_to_uuid,
                util.format(constants.fmt.IP_IN_USE,
                    d.params.belongs_to_type, d.params.belongs_to_uuid))
        ] }));
    },

    'create second nic with no IP': function (t) {
        d.mac = h.randomMAC();
        var params = {
            owner_uuid: uuids.b,
            belongs_to_uuid: uuids.a,
            belongs_to_type: 'server'
        };

        mod_nic.create(t, {
            mac: d.mac,
            params: params,
            partialExp: params,
            state: state
        });
    },

    'update second nic to same IP': function (t) {
        mod_nic.update(t, {
            mac: d.mac,
            params: {
                ip: d.params.ip,
                network_uuid: state.network.uuid
            },
            expErr: h.invalidParamErr({ errors: [
                mod_err.duplicateParam('ip', util.format(
                    constants.fmt.IP_EXISTS, state.network.uuid))
            ] })
        });
    }
};


exports['POST /networks/:uuid/nics (basic)'] = function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server'
    };
    napi.provisionNic(state.network.uuid, params, function (err, res) {
        if (err) {
            return h.doneWithError(t, err,
                'provision nic [network nic - no IP]');
        }
        var desc = util.format(' [%s: network nic - no IP]', res.mac);

        params.primary = false;
        params.mac = res.mac;
        params.ip = res.ip;
        params.state = 'running';
        h.addNetParamsToNic(state, params);

        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.d = params;
        state.desc.d = desc;
        state.ip.d = params.ip;
        return t.done();
    });
};


exports['POST /networks/:uuid/nics (with IP)'] = function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        ip: '10.99.99.201'
    };
    napi.provisionNic(state.network.uuid, params, function (err, res) {
        t.ifError(err, 'provision nic [network nic - with IP]');
        if (err) {
            return t.done();
        }
        var desc = util.format(' [%s: network nic - with IP]', res.mac);

        params.primary = false;
        params.mac = res.mac;
        params.state = 'running';
        h.addNetParamsToNic(state, params);

        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.e = params;
        state.desc.e = desc;
        state.ip.e = params.ip;
        return t.done();
    });
};


exports['Check IPs are created along with nics'] = function (t) {
    var ips = ['b', 'c', 'd', 'e'];

    var checkIP = function (ipNum, cb) {
        var ip = state.ip[ipNum];
        napi.getIP(state.network.uuid, ip, function (err, res) {
            var desc = util.format(' %s/%s%s',
                state.network.uuid, ip, state.desc[ipNum]);
            t.ifError(err, 'get IP' + desc);
            if (err) {
                return cb();
            }

            var exp = {
                belongs_to_type: 'server',
                belongs_to_uuid: uuids.a,
                ip: ip,
                network_uuid: state.network.uuid,
                owner_uuid: uuids.b,
                reserved: false,
                free: false
            };
            t.deepEqual(res, exp, 'IP params correct' + desc);
            return cb();
        });
    };

    vasync.forEachParallel({
        func: checkIP,
        inputs: ips
    }, function (err) {
        return t.done();
    });
};


exports['POST /nics (with reserved IP)'] = function (t) {
    var params = {
        owner_uuid: uuids.b,
        belongs_to_uuid: uuids.a,
        belongs_to_type: 'server',
        network_uuid: state.network.uuid,
        reserved: true
    };
    var mac = h.randomMAC();

    napi.createNic(mac, params, function (err, res) {
        var desc = util.format(' [%s: with reserved IP]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
            return t.done();
        }

        delete params.reserved;
        params.primary = false;
        params.mac = mac;
        params.ip = res.ip;
        params.state = 'running';
        h.addNetParamsToNic(state, params);
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.resNic2 = res;
        state.desc.resNic2 = desc;

        // IP should be reserved
        return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
            t.ifError(err2, 'get IP ' + params.ip + desc);
            if (err2) {
                return t.done();
            }

            var exp = {
                belongs_to_type: params.belongs_to_type,
                belongs_to_uuid: params.belongs_to_uuid,
                ip: params.ip,
                network_uuid: state.network.uuid,
                owner_uuid: params.owner_uuid,
                reserved: true,
                free: false
            };
            t.deepEqual(res2, exp, 'IP params correct: ' + params.ip + desc);

            return t.done();
        });
    });
};


exports['POST /nics (with model)'] = function (t) {
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
                    return t.done();
                }

                params.primary = false;
                params.mac = mac;
                params.state = 'running';
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
                    return t.done();
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
        return t.done();
    });
};


exports['POST /nics (duplicate nic)'] = function (t) {
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
            return t.done();
        }

        params.primary = false;
        t.equal(res.mac, mac, 'mac correct');

        napi.createNic(mac, params, function (err2) {
            t.ok(err2, 'error creating duplicate nic');
            if (!err2) {
                return t.done();
            }

            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('mac') ]
            }), 'Error body');

            return t.done();
        });
    });
};


exports['DELETE /nics/:mac (with reserved IP)'] = function (t) {
    var delNic = function (name, cb) {
        var nic = state[name];
        var desc = state.desc[name];

        return napi.deleteNic(nic.mac, function (err) {
            t.ifError(err, 'delete nic' + desc);
            if (err) {
                t.deepEqual(err.body, {}, 'err body for debugging');
                return cb(err);
            }

            return napi.getIP(state.network.uuid, nic.ip,
                function (err2, res2) {
                t.ifError(err2, 'get IP ' + nic.ip + desc);

                // A reserved IP should keep its owner information
                var exp = {
                    free: false,
                    ip: nic.ip,
                    network_uuid: state.network.uuid,
                    owner_uuid: nic.owner_uuid,
                    reserved: true
                };
                t.deepEqual(res2, exp, 'IP params correct: ' + nic.ip
                    + desc);

                return cb();
            });
        });
    };

    vasync.forEachParallel({
        func: delNic,
        inputs: ['resNic1', 'resNic2']
    }, function (err) {
        return t.done();
    });
};


exports['GET /nics/:mac'] = function (t) {
    var nics = ['a', 'b', 'c', 'd', 'e'];

    var checkNic = function (nicNum, cb) {
        var nic = state.nic[nicNum];
        var desc = state.desc[nicNum];
        napi.getNic(nic.mac, function (err, res) {
            t.ifError(err, 'get nic' + desc);
            if (err) {
                return cb(err);
            }
            t.deepEqual(res, nic, 'get params' + desc);
            return cb();
        });
    };

    vasync.forEachParallel({
        func: checkNic,
        inputs: nics
    }, function (err) {
        return t.done();
    });
};


exports['PUT /nics/:mac'] = function (t) {
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
        return t.done();
    });
};


exports['Check IPs are updated along with nics'] = function (t) {
    var ips = ['b', 'd'];

    var checkIP = function (ipNum, cb) {
        var ip = state.ip[ipNum];
        var desc = util.format(' %s/%s%s',
            state.network.uuid, ip, state.desc[ipNum]);
        napi.getIP(state.network.uuid, ip, function (err, res) {
            t.ifError(err, 'get updated IP' + desc);
            if (err) {
                return cb();
            }

            var exp = {
                belongs_to_uuid: uuids.d,
                belongs_to_type: 'other',
                ip: ip,
                network_uuid: state.network.uuid,
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
        return t.done();
    });
};


exports['PUT /nics (with network_uuid and state)'] = function (t) {
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
            return t.done();
        }

        state.nic.putIPnetUUID = params;
        state.desc.putIPnetUUID = desc;

        var updateParams = {
            network_uuid: state.network.uuid,
            state: 'stopped'
        };
        napi.updateNic(mac, updateParams, function (err2, res2) {
            t.ifError(err2, 'update nic' + desc);
            if (err2) {
                return t.done();
            }

            params.primary = false;
            params.mac = mac;
            params.ip = res2.ip;
            params.state = 'stopped';
            h.addNetParamsToNic(state, params);
            t.ok(res2.ip, 'nic now has IP address');
            t.deepEqual(res2, params, 'nic params returned' + desc);
            state.nic.putIPnetUUID = params;
            state.ip.putIPnetUUID = res2.ip;

            if (!res2.ip || !state.network.uuid) {
                t.ok(false, util.format(
                    'Not all params present: ip=%s, network_uuid=%s', res2.ip,
                    state.network.uuid));
                return t.done();
            }

            napi.getIP(state.network.uuid, res2.ip, function (err3, res3) {
                t.ifError(err3, 'get IP' + desc);
                if (err) {
                    return t.done();
                }

                var exp = {
                    belongs_to_type: 'server',
                    belongs_to_uuid: uuids.a,
                    ip: res2.ip,
                    network_uuid: state.network.uuid,
                    owner_uuid: uuids.b,
                    reserved: false,
                    free: false
                };
                t.deepEqual(res3, exp, 'IP params correct' + desc);

                return t.done();
            });
        });
    });
};


exports['GET /networks/admin'] = function (t) {
    napi.getNetwork('admin', function (err, res) {
        t.ifError(err, 'get admin network');
        if (err) {
            return t.done();
        }

        t.equal(res.name, 'admin', 'admin network found');
        state.adminNet = res;
        return t.done();
    });
};


// Note that this is the only test in this entire suite that affects
// networks used in production. This functionality is absolutely
// necessary for booter, so we should still make sure to test it
exports['PUT /nics (with network_uuid set to admin)'] = function (t) {
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
            return t.done();
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
                return t.done();
            }

            params.primary = false;
            params.mac = mac;
            params.ip = res2.ip;
            params.state = 'running';

            for (var n in h.nicNetParams) {
                if (state.adminNet.hasOwnProperty(h.nicNetParams[n])) {
                    params[h.nicNetParams[n]] =
                        state.adminNet[h.nicNetParams[n]];
                }
            }
            params.network_uuid = state.adminNet.uuid;
            params.owner_uuid = updateParams.owner_uuid;

            t.deepEqual(res2, params, 'nic params returned' + desc);
            state.nic.putIPwithName = params;
            state.ip.putIPwithName = res2.ip;

            napi.getIP(state.adminNet.uuid, res2.ip, function (err3, res3) {
                t.ifError(err3, 'get IP' + desc);
                if (err) {
                    return t.done();
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

                return t.done();
            });
        });
    });
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
            },
            state: state
        });
    },

    'create second nic with primary=true': function (t) {
        d.params.mac = d.macs[1];
        mod_nic.createAndGet(t, {
            mac: d.params.mac,
            params: d.params,
            partialExp: {
                primary: true
            },
            state: state
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


exports['PUT /nics (with network_uuid set to invalid name)'] = function (t) {
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
            return t.done();
        }

        state.nic.putIPwithInvalidName = params;
        state.desc.putIPwithInvalidName = desc;

        var updateParams = { network_uuid: state.network.name };
        napi.updateNic(mac, updateParams, function (err2, res2) {
            t.ok(err2, 'expected error');
            if (!err2) {
                return t.done();
            }

            // XXX: we end up with a stringified JSON object here, which is
            // definitely a bug somewhere.
            t.notEqual(err2.message,
                util.format('Unknown network "%s"', state.network.name),
                'Error message correct');
            return t.done();
        });
    });
};


exports['GET /nics (filtered by belongs_to_uuid)'] = function (t) {
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
        return t.done();
    });
};


exports['GET /nics (filtered)'] = function (t) {
    var filters = [
        { belongs_to_type: 'other' },
        { owner_uuid: uuids.b },
        { nic_tag: state.nicTag.name }
    ];

    var listNics = function (filter, cb) {
        napi.listNics(filter, function (err, res) {
            t.ifError(err, 'get nics: ' + JSON.stringify(filter));

            t.ok(res.length !== 0, 'nics in list: ' + JSON.stringify(filter));

            for (var i = 0; i < res.length; i++) {
                var cur = res[i];
                for (var f in filter) {
                    if (cur[f] != filter[f]) {
                        t.equal(cur[f], filter[f], util.format('nic "%s" ' +
                            'does not match filter %s=%s: %j',
                            cur.mac, f, filter[f], cur));
                        return cb();
                    }
                }
            }

            return cb();
        });
    };

    vasync.forEachParallel({
        func: listNics,
        inputs: filters
    }, function (err) {
        return t.done();
    });
};


exports['POST /nics (nic_tags_provided)'] = function (t) {
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
            return t.done();
        }

        state.nic.f = res;
        state.desc.f = util.format(' [%s: nic_tags_provided nic 1]', res.mac);
        t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
            'nic 1 nic_tags_provided');

        napi.createNic(h.randomMAC(), params2, function (err2, res2) {
            t.ifError(err2, 'create nic 2');
            if (err2) {
                return t.done();
            }

            state.nic.g = res2;
            state.desc.g = util.format(' [%s: nic_tags_provided nic 2]',
                res2.mac);
            t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
                'nic 2 nic_tags_provided');

            return t.done();
        });
    });
};


exports['POST /nics (nic_tags_provided scalar)'] = function (t) {
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
        return t.done();
    });
};


exports['GET /nics (filter: nic_tags_provided)'] = function (t) {
    var filter = {
        nic_tags_provided: [ state.nicTag2.name, state.nicTag3.name,
            state.nicTag5.name ]
    };

    napi.listNics(filter, function (err, res) {
        t.ifError(err, 'get nics: ' + JSON.stringify(filter));
        if (err) {
            return t.done();
        }
        t.equal(res.length, 3, '3 nics returned');

        if (res.length === 0) {
            return t.done();
        }

        var macs = res.reduce(function (arr, x) {
            arr.push(x.mac);
            return arr;
        }, []).sort();

        t.deepEqual(macs, [ state.nic.f.mac, state.nic.g.mac,
            state.nic.ntps1.mac ].sort(),
            'all three nics returned');
        return t.done();
    });
};


exports['DELETE /nics/:mac'] = function (t) {
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
    }, function (err) {
        return t.done();
    });
};


exports['Check IPs are freed along with nics'] = function (t) {
    var ips = Object.keys(state.ip);

    var checkIP = function (ipDesc, cb) {
        var ip = state.ip[ipDesc];
        var net = state.network;

        if (ipDesc == 'putIPwithName') {
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
    }, function (err) {
        return t.done();
    });
};



// --- Teardown



exports['teardown'] = function (t) {
    h.deleteNetwork(t, napi, state, function () {
        h.deleteNicTags(t, napi, state);
    });
};


// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
