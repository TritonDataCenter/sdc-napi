/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Unit tests for nic tag endpoints
 */

var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_moray = require('../lib/moray');
var test = require('tape');
var util = require('util');



// --- Globals



var INVALID_MSG = 'must only contain numbers, letters and underscores';
var NAPI;
var cur = 0;


// --- Helpers



function newTag(t, callback) {
    if (!NAPI) {
        return callback();
    }

    NAPI.createNicTag('curTag' + cur, function (err, obj) {
        t.ifErr(err, 'tag creation');
        t.ok(obj, 'tag created');
        cur++;

        return callback(err, obj);
    });
}



// --- Setup



test('Create client and server', function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        t.end();
    });
});


// --- Create tests



test('Create nic tag', function (t) {
    NAPI.createNicTag('newtagname', function (err, obj, req, res) {
        if (h.ifErr(t, err, 'nic tag create')) {
            return t.end();
        }

        var added = mod_moray.getObj('napi_nic_tags', 'newtagname');
        t.equal(res.statusCode, 200, 'status code');
        var expObj = {
            name: 'newtagname',
            uuid: added.uuid
        };
        t.deepEqual(obj, expObj, 'create response');

        NAPI.getNicTag('newtagname', function (err2, res2) {
            if (h.ifErr(t, err2, 'nic tag get')) {
                return t.end();
            }

            t.deepEqual(res2, expObj, 'get response');

            return t.end();
        });
    });
});


test('Create nic tag - invalid name', function (t) {
    NAPI.createNicTag('has spaces', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('name', INVALID_MSG) ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic tag - name too long', function (t) {
    var tenBs = 'bbbbbbbbbb';
    NAPI.createNicTag(tenBs + tenBs + tenBs + 'bb', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('name',
                'must not be longer than 31 characters') ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic tag - missing name', function (t) {
    // Use .post directly since the client checks to make sure name is
    // specified
    NAPI.post('/nic_tags', {}, function (err, obj, req, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.missingParam('name') ],
            message: 'Missing parameters'
        }), 'Error body');

        return t.end();
    });
});


test('Create nic tag - duplicate name', function (t) {
    NAPI.createNicTag('tag1', function (err, res) {
        t.ifError(err);
        t.ok(res, 'result returned');
        NAPI.createNicTag('tag1', function (err2) {
            t.ok(err2, 'error returned');
            if (!err2) {
                return t.end();
            }

            t.equal(err2.statusCode, 422, '422 returned');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('name') ]
            }), 'Error body');

            return t.end();
        });
    });
});



// --- Delete tests



test('Delete nic tag in use', function (t) {
    newTag(t, function (tErr, curTag) {
        var netParams = {
            name: 'foo',
            nic_tag: curTag.name,
            provision_start_ip: '10.0.2.1',
            provision_end_ip: '10.0.2.10',
            subnet: '10.0.2.0/24',
            vlan_id: 200
        };

        NAPI.createNetwork(netParams, function (err, net) {
            t.ifError(err);

            NAPI.deleteNicTag(curTag.name, function (err2) {
                t.ok(err2, 'error returned');
                if (!err2) {
                    return t.end();
                }

                t.equal(err2.statusCode, 422, 'status code');
                t.deepEqual(err2.body, {
                    code: 'InUse',
                    errors: [ mod_err.usedBy('network', net.uuid) ],
                    message: 'Nic tag is in use'
                }, 'Error body');

                return t.end();
            });
        });
    });
});



// --- Update tests



test('Update nic tag - successful', function (t) {
    newTag(t, function (tErr, curTag) {
        NAPI.updateNicTag(curTag.name, { name: 'bar2' },
            function (err, obj, req, res) {
            t.ifError(err, 'error returned');
            if (err) {
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                name: 'bar2',
                uuid: curTag.uuid
            }, 'Response');

            return t.end();
        });
    });
});


test('Update nic tag - missing name', function (t) {
    newTag(t, function (tErr, curTag) {
        NAPI.updateNicTag(curTag.name, { }, function (err, obj, req, res) {
            t.ok(err, 'error returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [ h.missingParam('name') ],
                message: 'Missing parameters'
            }), 'Error body');

            return t.end();
        });
    });
});


test('Update nic tag - in use', function (t) {
    newTag(t, function (tErr, curTag) {
        var netParams = {
            name: 'foo2',
            nic_tag: curTag.name,
            provision_start_ip: '10.0.2.1',
            provision_end_ip: '10.0.2.10',
            subnet: '10.0.2.0/24',
            vlan_id: 200
        };

        NAPI.createNetwork(netParams, function (err, net) {
            t.ifError(err);

            NAPI.updateNicTag(curTag.name, { name: 'bar3' },
                function (err2, res) {
                t.ok(err2, 'error returned');
                if (!err2) {
                    return t.end();
                }

                t.equal(err2.statusCode, 422, 'status code');
                t.deepEqual(err2.body, {
                    code: 'InUse',
                    errors: [ mod_err.usedBy('network', net.uuid) ],
                    message: 'Nic tag is in use'
                }, 'Error body');

                return t.end();
            });
        });
    });
});


test('Update nic tag - already used name', function (t) {
    newTag(t, function (tErr, curTag) {
        NAPI.createNicTag('somenewtag1', function (err, res) {
            t.ifError(err);

            NAPI.updateNicTag(curTag.name, { name: 'somenewtag1' },
                function (err2) {
                t.ok(err2, 'error returned');
                if (!err2) {
                    return t.end();
                }

                t.equal(err2.statusCode, 422, 'status code');
                t.deepEqual(err2.body, h.invalidParamErr({
                    errors: [ mod_err.duplicateParam('name') ]
                }), 'Error body');

                return t.end();
            });
        });
    });
});



// --- Teardown



test('Stop server', function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        t.end();
    });
});
