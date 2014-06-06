/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for nic tag endpoints
 */

var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var util = require('util');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var INVALID_MSG = 'must only contain numbers, letters and underscores';
var NAPI;
var cur = 0;
var curTag;



// --- Setup



exports['Create client and server'] = function (t) {
    h.createClientAndServer(function (err, res) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        NAPI = res;
        t.done();
    });
};


exports.setUp = function (cb) {
    if (!NAPI) {
        return cb();
    }

    NAPI.createNicTag('curTag' + cur, function (err, obj) {
        curTag = obj;
        cur++;
        return cb();
    });
};



// --- Create tests



exports['Create nic tag'] = function (t) {
    NAPI.createNicTag('newtagname', function (err, obj, req, res) {
        if (h.ifErr(t, err, 'nic tag create')) {
            return t.done();
        }

        var bucket = h.morayBuckets()['napi_nic_tags'];
        var added = bucket['newtagname'].value;

        t.equal(res.statusCode, 200, 'status code');
        var expObj = {
            name: 'newtagname',
            uuid: added.uuid
        };
        t.deepEqual(obj, expObj, 'create response');

        NAPI.getNicTag('newtagname', function (err2, res2) {
            if (h.ifErr(t, err2, 'nic tag get')) {
                return t.done();
            }

            t.deepEqual(res2, expObj, 'get response');

            return t.done();
        });
    });
};


exports['Create nic tag - invalid name'] = function (t) {
    NAPI.createNicTag('has spaces', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('name', INVALID_MSG) ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic tag - name too long'] = function (t) {
    var tenBs = 'bbbbbbbbbb';
    NAPI.createNicTag(tenBs + tenBs + tenBs + 'bb', function (err, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('name',
                'must not be longer than 31 characters') ]
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic tag - missing name'] = function (t) {
    // Use .post directly since the client checks to make sure name is
    // specified
    NAPI.post('/nic_tags', {}, function (err, obj, req, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.missingParam('name') ],
            message: 'Missing parameters'
        }), 'Error body');

        return t.done();
    });
};


exports['Create nic tag - duplicate name'] = function (t) {
    NAPI.createNicTag('tag1', function (err, res) {
        t.ifError(err);
        t.ok(res, 'result returned');
        NAPI.createNicTag('tag1', function (err2) {
            t.ok(err2, 'error returned');
            if (!err2) {
                return t.done();
            }

            t.equal(err2.statusCode, 422, '422 returned');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('name') ]
            }), 'Error body');

            return t.done();
        });
    });
};



// --- Delete tests



exports['Delete nic tag in use'] = function (t) {
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
                return t.done();
            }

            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, {
                code: 'InUse',
                errors: [ mod_err.usedBy('network', net.uuid) ],
                message: 'Nic tag is in use'
            }, 'Error body');

            return t.done();
        });
    });
};



// --- Update tests



exports['Update nic tag - successful'] = function (t) {
    NAPI.updateNicTag(curTag.name, { name: 'bar2' },
        function (err, obj, req, res) {
        t.ifError(err, 'error returned');
        if (err) {
            return t.done();
        }

        t.equal(res.statusCode, 200, 'status code');
        t.deepEqual(obj, {
            name: 'bar2',
            uuid: curTag.uuid
        }, 'Response');

        return t.done();
    });
};


exports['Update nic tag - missing name'] = function (t) {
    NAPI.updateNicTag(curTag.name, { },
        function (err, obj, req, res) {
        t.ok(err, 'error returned');
        if (!err) {
            return t.done();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ h.missingParam('name') ],
            message: 'Missing parameters'
        }), 'Error body');

        return t.done();
    });
};


exports['Update nic tag - in use'] = function (t) {
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

        NAPI.updateNicTag(curTag.name, { name: 'bar3' }, function (err2, res) {
            t.ok(err2, 'error returned');
            if (!err2) {
                return t.done();
            }

            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, {
                code: 'InUse',
                errors: [ mod_err.usedBy('network', net.uuid) ],
                message: 'Nic tag is in use'
            }, 'Error body');

            return t.done();
        });
    });
};


exports['Update nic tag - already used name'] = function (t) {
    NAPI.createNicTag('somenewtag1', function (err, res) {
        t.ifError(err);

        NAPI.updateNicTag(curTag.name, { name: 'somenewtag1' },
            function (err2) {
            t.ok(err2, 'error returned');
            if (!err2) {
                return t.done();
            }

            t.equal(err2.statusCode, 422, 'status code');
            t.deepEqual(err2.body, h.invalidParamErr({
                errors: [ mod_err.duplicateParam('name') ]
            }), 'Error body');

            return t.done();
        });
    });
};



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
        setup: exports['Create client and server'],
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports['Stop server']
    };
}
