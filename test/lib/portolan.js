/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
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
var mod_moray = require('moray');
var mod_portolan_moray = require('portolan-moray');
var util_ip = require('../../lib/util/ip');
var util_mac = require('../../lib/util/mac');

var doneErr = common.doneErr;
var doneRes = common.doneRes;



// --- Globals



var MORAY_CLIENT;



// --- Internal



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

    // Convert numeric MAC addrs to real addresses
    if (obj.mac) {
        obj.mac = util_mac.ntoa(obj.mac);
    }

    if (opts.exp) {
        exp = clone(opts.exp);
        if (exp.ip) {
            exp.ip = util_ip.toIPAddr(exp.ip).toString({ format: 'v6' });
        }

        t.deepEqual(obj, exp, 'expected object');
    }

    if (opts.partialExp) {
        var partialRes = {};
        for (var p in opts.partialExp) {
            partialRes[p] = obj[p];
        }

        t.deepEqual(partialRes, opts.partialExp, 'partial result');
    }

    return doneRes(obj, t, callback);
}


function getMorayClient(callback) {
    if (MORAY_CLIENT) {
        return callback(null, MORAY_CLIENT);
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

        // XXX: Possible to get an error event here?

        MORAY_CLIENT.once('connect', function _afterConnect() {
            return callback(null, MORAY_CLIENT);
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

    getMorayClient(function (_, client) {
        var vl2Opts = {
            log: log,
            moray: client,
            noCache: true,
            vl2_mac: util_mac.aton(nic.mac),
            vl2_vnet_id: vnetID
        };

        mod_portolan_moray.vl2Lookup(vl2Opts,
                afterMoray.bind(null, t, opts, function () {

            var vl3Opts = {
                log: log,
                moray: client,
                noCache: true,
                vl3_ip: util_ip.toIPAddr(nic.ip).toString({ format: 'v6' }),
                vl3_vnet_id: vnetID
            };

            mod_portolan_moray.vl3Lookup(vl3Opts,
                afterMoray.bind(null, t, opts, callback));
        }));
    });
}


function portolanNotFoundErr() {
    return { code: 'ENOENT' };
}


function underlayMapping(t, opts, callback) {
    common.assertArgs(t, opts, callback);

    assert.string(opts.params.cn_uuid, 'opts.params.cn_uuid');

    getMorayClient(function (_, client) {
        var lookupOpts = {
            moray: client,
            noCache: true,
            cn_uuid: opts.params.cn_uuid
        };

        mod_portolan_moray.underlayLookup(lookupOpts,
            afterMoray.bind(null, t, opts, callback));
    });
}


module.exports = {
    closeClient: closeClient,
    notFoundErr: portolanNotFoundErr,
    nicVnetID: nicVnetID,
    overlayMapping: overlayMapping,
    underlayMapping: underlayMapping
};
