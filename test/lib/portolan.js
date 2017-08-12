/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Test helpers for dealing with overlays
 */

'use strict';

var assert = require('assert-plus');
var clone = require('clone');
var config = require('./config');
var common = require('./common');
var log = require('./log');
var mod_mac = require('macaddr');
var mod_moray = require('moray');
var mod_portolan_moray = require('portolan-moray');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');

var doneErr = common.doneErr;
var doneRes = common.doneRes;



// --- Globals



var MORAY_CLIENT;



// --- Internal

function toMorayObj(exp) {
    assert.object(exp);

    // Convert colon-delimited MAC addresses to numeric form
    if (exp.mac) {
        exp.mac = mod_mac.parse(exp.mac).toLong();
    }

    // Ensure IP addresses are in v6 notation
    if (exp.ip) {
        exp.ip = util_ip.toIPAddr(exp.ip).toString({ format: 'v6' });
    }
}


function afterMoray(t, opts, callback, err, realObj) {
    var exp;
    var obj;

    if (realObj) {
        obj = clone(realObj);
    }

    if (opts.expErr) {
        t.ok(err, 'expected err');
        if (!err) {
            t.deepEqual(obj, {}, 'object returned instead of error');
            return doneRes(obj, t, callback);
        }

        t.deepEqual(err, opts.expErr, 'expected error');
        return doneErr(err, t, callback);
    }

    t.ifErr(err, 'lookup err');
    if (err) {
        return doneErr(err, t, callback);
    }

    if (opts.exp) {
        exp = clone(opts.exp);
        toMorayObj(exp);
        t.deepEqual(obj, exp, 'expected object');
    }

    if (opts.partialExp) {
        exp = clone(opts.partialExp);
        toMorayObj(exp);

        var partialRes = {};
        for (var p in exp) {
            partialRes[p] = obj[p];
        }

        t.deepEqual(partialRes, exp, 'partial result');
    }

    return doneRes(obj, t, callback);
}


function afterLogList(t, opts, callback, err, realObj) {
    assert.optionalArrayOfObject(opts.exp);

    var exp;
    var obj;

    if (realObj) {
        obj = clone(realObj);
    }

    if (opts.expErr) {
        t.ok(err, 'expected err');
        if (!err) {
            t.deepEqual(obj, {}, 'object returned instead of error');
            doneRes(realObj, t, callback);
            return;
        }

        t.deepEqual(err, opts.expErr, 'expected error');
        doneErr(err, t, callback);
        return;
    }

    t.ifErr(err, 'lookup err');
    if (err) {
        doneErr(err, t, callback);
        return;
    }

    if (opts.exp) {
        exp = clone(opts.exp);
        exp.forEach(function (ev) {
            toMorayObj(ev.record);
        });
        obj.forEach(function (ev) {
            delete ev.id;
        });
        t.deepEqual(obj, exp, 'expected array of objects');
    }

    doneRes(realObj, t, callback);
}


function getMorayClient(callback) {
    if (MORAY_CLIENT) {
        callback(null, MORAY_CLIENT);
        return;
    }

    assert.object(config, 'config');
    assert.object(config.moray, 'config.moray');
    assert.func(callback, 'callback');

    mod_portolan_moray.initConsumer({}, function _afterInit() {
        MORAY_CLIENT = mod_moray.createClient({
            host: config.moray.host,
            log: log,
            port: config.moray.port
        });


        MORAY_CLIENT.once('error', callback);

        MORAY_CLIENT.once('connect', function _afterConnect() {
            callback(null, MORAY_CLIENT);
        });
    });
}



// --- Exports



function closeClient(t) {
    if (MORAY_CLIENT) {
        MORAY_CLIENT.close();
    }

    return t.end();
}


/**
 * Extract the vnet_id from a nic's nic tag and return it.
 */
function nicVnetID(t, nic) {
    var match;
    var vnetID;

    t.ok(nic.nic_tag, 'nic tag present');
    if (!nic.nic_tag) {
        throw new Error('nic tag required in nic');
    }

    match = nic.nic_tag.match(/\/(\d+)$/);
    t.ok(match, 'vnet_id found in nic tag');
    if (!match) {
        throw new Error('no vnet_id found in nic tag');
    }

    vnetID = Number(match[1]);

    if (isNaN(vnetID)) {
        throw new Error('vnet_id isNaN: ' + vnetID);
    }

    return vnetID;
}


function overlayMapping(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    assert.object(opts.params.nic, 'opts.params.nic');

    var nic = opts.params.nic;
    var vnetID;

    try {
        vnetID = nicVnetID(t, nic);
    } catch (vnetErr) {
        return doneErr(vnetErr, t, callback);
    }

    getMorayClient(function (err, client) {
        if (err) {
            callback(err);
            return;
        }
        var vl2Opts = {
            log: log,
            moray: client,
            noCache: true,
            vl2_mac: mod_mac.parse(nic.mac).toLong(),
            vl2_vnet_id: vnetID
        };

        function vl3Check() {
            var vl3Opts = {
                log: log,
                moray: client,
                noCache: true,
                vl3_ip: util_ip.toIPAddr(nic.ip).toString({ format: 'v6' }),
                vl3_vnet_id: vnetID
            };

            mod_portolan_moray.vl3Lookup(vl3Opts,
                afterMoray.bind(null, t, opts, callback));
        }

        if (opts.skipVL2) {
            vl3Check();
        } else {
            mod_portolan_moray.vl2Lookup(vl2Opts,
                afterMoray.bind(null, t, opts, vl3Check));
        }
    });
}


function portolanNotFoundErr() {
    return { code: 'ENOENT' };
}


function underlayMapping(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');

    getMorayClient(function (err, client) {
        if (err) {
            callback(err);
            return;
        }
        var lookupOpts = {
            moray: client,
            noCache: true,
            cn_uuid: opts.params.cn_uuid
        };

        mod_portolan_moray.underlayLookup(lookupOpts,
            afterMoray.bind(null, t, opts, callback));
    });
}


function logReq(t, opts, callback) {
    common.assertArgsList(t, opts, callback);
    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');

    opts.type = 'event';

    getMorayClient(function (err, client) {
        if (err) {
            callback(err);
            return;
        }

        var lookupOpts = {
            log: log,
            limit: 1000,
            moray: client,
            noCache: true,
            cnUuid: opts.params.cn_uuid
        };

        mod_portolan_moray.logReq(lookupOpts,
            afterLogList.bind(null, t, opts, function (lErr, res) {
            if (lErr) {
                doneErr(lErr, t, callback);
                return;
            }

            vasync.forEachParallel({
                inputs: res,
                func: function (entry, cb) {
                    mod_portolan_moray.logRm({
                        log: log,
                        moray: client,
                        uuid: entry.id
                    }, cb);
                }
            }, function (dErr) {
                if (dErr) {
                    doneErr(dErr, t, callback);
                    return;
                }

                doneRes(res, t, callback);
            });
        }));
    });
}


module.exports = {
    closeClient: closeClient,
    notFoundErr: portolanNotFoundErr,
    nicVnetID: nicVnetID,
    logReq: logReq,
    overlayMapping: overlayMapping,
    underlayMapping: underlayMapping
};
