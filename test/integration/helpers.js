/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for NAPI integration tests
 */

var assert = require('assert');
var bunyan = require('bunyan');
var config = require('../../lib/config');
var common = require('../lib/common');
var fs = require('fs');
var mod_client = require('../lib/client');
var path = require('path');
var util = require('util');
var util_ip = require('../../lib/util/ip');
var vasync = require('vasync');



// --- Globals



var NIC_NET_PARAMS = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers',
    'routes'];
var CONFIG_FILE = path.normalize(__dirname + '/../../config.json');
var CONF = config.load(CONFIG_FILE);



// --- Exported functions



/*
 * Add network parameters from state.network to a nic
 */
function addNetParamsToNic(state, params) {
    NIC_NET_PARAMS.forEach(function (n) {
        if (state.network.hasOwnProperty(n)) {
            params[n] = state.network[n];
        }
    });

    params.network_uuid = state.network.uuid;
}


/**
 * Create a NAPI client pointed at the local zone's NAPI (with a req_id for
 * tracking requests)
 */
function createNAPIclient(t) {
    var client = common.createClient('http://localhost:' + CONF.port, t);
    if (!mod_client.initialized()) {
        mod_client.set(client);
    }

    return client;
}


/**
 * Creates a nic tag for testing; stores the result in state.nicTag, or
 * state[targetName] if targetName is specified
 */
function createNicTag(t, napi, state, targetName, callback) {
    var name = 'int_test_' + process.pid;
    if (targetName) {
        if (typeof (targetName) === 'function') {
            callback = targetName;
            targetName = null;
        } else {
            name = name + '_' + targetName;
        }
    }

    napi.createNicTag(name, function (err, res) {
        common.ifErr(t, err, 'creating nic tag ' + name);
        if (res) {
            t.ok(res.uuid,
                util.format('test nic tag: uuid=%s, name=%s', res.uuid,
                    res.name));
            if (targetName) {
                state[targetName] = res;
            } else {
                state.nicTag = res;
            }

            if (!state.hasOwnProperty('nic_tags')) {
                state.nic_tags = [];
            }

            state.nic_tags.push(res);
        }

        if (callback) {
            return callback(err, res);
        } else {
            return t.done();
        }
    });
}


/**
 * Creates all of the nic tags specified in tags
 */
function createNicTags(t, napi, state, tags, callback) {
    vasync.forEachParallel({
        inputs: tags,
        func: createNicTag.bind(null, t, napi, state)
    }, function (err, res) {
        if (callback) {
            return callback(err, res);
        }

        return t.done();
    });
}


/**
 * Deletes the testing nic tag stored in state.nicTag or state[name], if
 * name is specified
 */
function deleteNicTag(t, napi, state, name, callback) {
    var tagName = state.nicTag.name;
    if (name) {
        if (typeof (name) === 'function') {
            callback = name;
            name = null;
        } else {
            tagName = state[name].name;
        }
    }


    napi.deleteNicTag(tagName, function (err) {
        t.ifError(err, 'delete test nic tag: ' + tagName);
        if (callback) {
            return callback(err);
        }

        return t.done();
    });
}


/**
 * Deletes all nic tags in state.nic_tags
 */
function deleteNicTags(t, napi, state) {
    if (!state.hasOwnProperty('nic_tags') || state.nic_tags.length === 0) {
        return t.done();
    }

    vasync.forEachParallel({
        inputs: state.nic_tags,
        func: function _delNicTag(tag, cb) {
            napi.deleteNicTag(tag.name, function (err) {
                common.ifErr(t, err, 'delete test nic tag: ' + tag.name);

                // We're calling this in teardown, so plow on anyway with
                // deleting the rest of the tags
                return cb();
            });
        }
    }, function (err) {
        return t.done();
    });
}


/*
 * Creates a network for testing; stores the result in state.network
 */
function createNetwork(t, napi, state, extraParams, targetName, callback) {
    var params = {
        name: 'network-integration-' + process.pid,
        vlan_id: 0,
        subnet: '10.99.99.0/24',
        provision_start_ip: '10.99.99.5',
        provision_end_ip: '10.99.99.250',
        nic_tag: state.nicTag.name
    };

    if (typeof (targetName) === 'function') {
        callback = targetName;
        targetName = null;
    }

    if (targetName) {
        params.name = params.name + '-' + targetName;
    }

    for (var p in extraParams) {
        params[p] = extraParams[p];
    }

    napi.createNetwork(params, function (err, res) {
        t.ifError(err, 'create network');
        if (err) {
            if (callback) {
                return callback(err);
            }
            return t.done();
        }

        t.ok(res.uuid, 'test network uuid: ' + res.uuid);

        params.uuid = res.uuid;
        params.resolvers = [];
        params.netmask = util_ip.bitsToNetmask(params.subnet.split('/')[1]);
        t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
        if (targetName) {
            state[targetName] = res;
        } else {
            state.network = res;
        }

        if (callback) {
            return callback();
        }
        return t.done();
    });
}


/**
 * Deletes the testing network stored in state.network
 */
function deleteNetwork(t, napi, state, name, callback) {
    var net = state.network;
    if (name) {
        if (typeof (name) === 'function') {
            callback = name;
        } else {
            net = state[name];
        }
    }

    napi.deleteNetwork(net.uuid, { force: true }, function (err) {
        common.ifErr(t, err, 'delete network ' + name);
        if (callback) {
            return callback(err);
        }

        return t.done();
    });
}


/**
 * Logs relevant information about the error, and ends the test
 */
function doneWithError(t, err, desc) {
    t.ifError(err, desc);

    if (err.body.hasOwnProperty('errors')) {
        t.deepEqual(err.body.errors, {}, 'display body errors');
    }
    return t.done();
}


/**
 * Asserts that substr is a substring or match for str. Similar to tap's
 * similar() (that's a little test humour for you).
 */
function similar(t, str, substr, message) {
    t.ok((str.indexOf(substr) !== -1) || (str == substr), message);
}



module.exports = {
    addNetParamsToNic: addNetParamsToNic,
    createNAPIclient: createNAPIclient,
    createNetwork: createNetwork,
    createNicTag: createNicTag,
    createNicTags: createNicTags,
    deleteNetwork: deleteNetwork,
    deleteNicTag: deleteNicTag,
    deleteNicTags: deleteNicTags,
    doneWithError: doneWithError,
    ifErr: common.ifErr,
    invalidParamErr: common.invalidParamErr,
    nicNetParams: NIC_NET_PARAMS,
    randomMAC: common.randomMAC,
    similar: similar,
    ufdsAdminUuid: CONF.ufdsAdminUuid
};
