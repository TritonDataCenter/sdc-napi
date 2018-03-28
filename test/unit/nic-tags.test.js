/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Unit tests for nic tag endpoints
 */

'use strict';

var assert = require('assert-plus');
var common = require('../lib/common');
var h = require('./helpers');
var mod_err = require('../../lib/util/errors');
var mod_server = require('../lib/server');
var models = require('../../lib/models');
var constants = require('../../lib/util/constants');
var test = require('tape');



// --- Globals



var INVALID_MSG = 'must only contain numbers, letters and underscores';
var MORAY;
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
    h.reset();

    h.createClientAndServer(function (err, res, moray) {
        t.ifError(err, 'server creation');
        t.ok(res, 'client');
        t.ok(moray, 'moray');
        NAPI = res;
        MORAY = moray;
        t.end();
    });
});


// --- Create tests



test('Create nic tag', function (t) {
    NAPI.createNicTag('newtagname', function (err, obj, req, res) {
        if (h.ifErr(t, err, 'nic tag create')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        MORAY.getObject(models.nic_tag.bucket().name, 'newtagname',
            function (mErr, added) {
            if (h.ifErr(t, mErr, 'Getting NIC tag should succeed')) {
                t.end();
                return;
            }

            var expObj = {
                name: 'newtagname',
                uuid: added.value.uuid,
                mtu: constants.MTU_DEFAULT
            };
            t.deepEqual(obj, expObj, 'create response');

            NAPI.getNicTag('newtagname', function (err2, res2) {
                if (h.ifErr(t, err2, 'nic tag get')) {
                    t.end();
                    return;
                }

                t.deepEqual(res2, expObj, 'get response');
                t.end();
            });
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


test('Create nic tag - missing all parameters', function (t) {
    // Use .post directly since the client checks to make sure name is
    // specified
    NAPI.post('/nic_tags', {}, function (err, obj, req, res) {
        t.ok(err, 'error returned');
        t.deepEqual(obj, null, 'no value returned');
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


test('Create nic tag - with MTU', function (t) {
    NAPI.createNicTag('newtagnamemtu', { mtu: constants.MTU_MAX },
        function (err, obj, req, res) {
        if (h.ifErr(t, err, 'nic tag create - MTU')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code - MTU');
        MORAY.getObject(models.nic_tag.bucket().name, 'newtagnamemtu',
            function (mErr, added) {
            t.ifError(mErr, 'Getting NIC tag should succeed');
            var expObj = {
                name: 'newtagnamemtu',
                uuid: added.value.uuid,
                mtu: constants.MTU_MAX
            };
            t.deepEqual(obj, expObj, 'create response - MTU');

            NAPI.getNicTag('newtagnamemtu', function (gErr, tagObj) {
                if (h.ifErr(t, gErr, 'nic tag get - MTU')) {
                    t.end();
                    return;
                }

                t.deepEqual(tagObj, expObj, 'get response - MTU');
                t.end();
            });
        });
    });
});


test('Create nic tag - with bogus MTU', function (t) {
    NAPI.createNicTag('mtustr', { mtu: 'foobar' }, function (err, res) {
        t.ok(err, 'err returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('mtu', constants.MTU_NICTAG_INVALID_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic tag - with MTU < min', function (t) {
    NAPI.createNicTag('badmtu', { mtu: constants.MTU_NICTAG_MIN - 10 },
        function (err, res) {
        t.ok(err, 'err returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('mtu', constants.MTU_NICTAG_INVALID_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create nic tag - with MTU > max', function (t) {
    NAPI.createNicTag('badmtu', { mtu: constants.MTU_NICTAG_MAX + 10 },
        function (err, res) {
        t.ok(err, 'err returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [
                mod_err.invalidParam('mtu', constants.MTU_NICTAG_INVALID_MSG)
            ]
        }), 'Error body');

        return t.end();
    });
});


test('Create admin nic tag - with default MTU', function (t) {
    NAPI.createNicTag('admin', { mtu: constants.MTU_DEFAULT },
        function (err, obj, req, res) {
        if (h.ifErr(t, err, 'nic tag create ')) {
            t.end();
            return;
        }

        t.equal(res.statusCode, 200, 'status code');
        MORAY.getObject(models.nic_tag.bucket().name, 'admin',
            function (mErr, added) {
            if (h.ifErr(t, mErr, 'Getting NIC tag should succeed')) {
                t.end();
                return;
            }

            var expObj = {
                name: 'admin',
                uuid: added.value.uuid,
                mtu: constants.MTU_DEFAULT
            };
            t.deepEqual(obj, expObj, 'create response');

            NAPI.getNicTag('admin', function (gErr, _obj) {
                if (h.ifErr(t, gErr, 'nic tag get')) {
                    t.end();
                    return;
                }

                t.deepEqual(_obj, expObj, 'get response');

                // clean up 'admin' nictag, tested elsewhere.
                NAPI.deleteNicTag('admin', function (dErr) {
                    t.ifError(dErr, 'err cleaning up admin nic tag');
                    t.end();
                });
            });
        });
    });
});

test('Create admin nic tag - with wrong MTU', function (t) {
    NAPI.createNicTag('admin', { mtu: constants.MTU_DEFAULT + 10 },
        function (err, obj, req, res) {

        t.ok(err, 'error returned');
        t.deepEqual(obj, null, 'no value returned');
        if (!err) {
            return t.end();
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('mtu', constants.ADMIN_MTU_MSG) ]
        }), 'Error body');

        return t.end();
    });
});


// --- Get tests


test('Get nic tag with invalid name', function (t) {
    NAPI.getNicTag('__ad**$@$sfasdf', function (err, obj) {
        t.ok(err, 'error returned');
        t.deepEqual(obj, null, 'no value returned');
        if (!err) {
            t.end();
            return;
        }

        t.equal(err.statusCode, 422, '422 returned');
        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ mod_err.invalidParam('name', INVALID_MSG) ]
        }), 'Error body');

        t.end();
    });
});


// --- Delete tests


test('Delete nic tag in use', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        var netParams = h.validNetworkParams({
            nic_tag: curTag.name
        });

        NAPI.createNetwork(netParams, function (err, net) {
            t.ifError(err);
            if (err) {
                return t.end();
            }

            NAPI.deleteNicTag(curTag.name, function (err2) {
                t.ok(err2, 'error returned');
                if (!err2) {
                    return t.end();
                }

                t.equal(err2.statusCode, 422, 'status code');
                t.deepEqual(err2.body, h.invalidParamErr({
                    errors: [
                        mod_err.usedByParam('nic_tag', 'network', net.uuid)
                    ]
                }, 'Error body'));

                return t.end();
            });
        });
    });
});



// --- Update tests



test('Update nic tag - successful', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name, { name: 'bar2' },
            function (err, obj, req, res) {
            t.ifError(err, 'error returned');
            if (err) {
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                name: 'bar2',
                uuid: curTag.uuid,
                mtu: constants.MTU_NICTAG_MIN
            }, 'Response');

            return t.end();
        });
    });
});


test('Update nic tag - missing name', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name, { }, function (err, obj, req, res) {
            t.ok(err, 'error returned');
            t.deepEqual(obj, null, 'no value returned');
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


test('Update nic tag - nic tag in use by network', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        var netParams = h.validNetworkParams({
            nic_tag: curTag.name
        });

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
                    code: 'InvalidParameters',
                    errors: [
                        mod_err.usedByParam('nic_tag', 'network', net.uuid)
                    ],
                    message: 'Invalid parameters'
                }, 'Error body');

                return t.end();
            });
        });
    });
});


test('Update nic tag - already used name', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

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

test('Update nic tag - MTU only', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name,
            { mtu: constants.MTU_NICTAG_MIN + 10 },
            function (err, obj, req, res) {
            t.ifError(err, 'error returned');
            if (err) {
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                name: curTag.name,
                uuid: curTag.uuid,
                mtu: constants.MTU_NICTAG_MIN + 10
            }, 'Response');

            return t.end();
        });
    });
});

test('Update nic tag - MTU and name', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name,
            { name: 'newname', mtu: constants.MTU_NICTAG_MIN + 10 },
            function (err, obj, req, res) {
            t.ifError(err, 'error returned');
            if (err) {
                return t.end();
            }

            t.equal(res.statusCode, 200, 'status code');
            t.deepEqual(obj, {
                name: 'newname',
                uuid: curTag.uuid,
                mtu: constants.MTU_NICTAG_MIN + 10
            }, 'Response');

            return t.end();
        });
    });
});

test('update admin nictag - name', function (t) {
    NAPI.createNicTag('admin', { name: 'admin' }, function (tErr, nictag) {
        if (h.ifErr(t, tErr, 'nic tag creation')) {
            return t.end();
        }

        t.ok(nictag, 'nictag object returned');

        NAPI.updateNicTag('admin', { name: 'notadmin' },
            function (err, obj, req, res) {
            t.ok(err, 'err returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [
                    mod_err.invalidParam('name', constants.ADMIN_UPDATE_MSG)
                ]
            }), 'Error body');

            // clean up 'admin' nictag, tested elsewhere.
            return NAPI.deleteNicTag('admin', function (err2) {
                t.ifError(err2, 'err cleaning up admin nic tag');
                t.end();
            });
        });
    });
});

test('update admin nictag - MTU', function (t) {
    NAPI.createNicTag('admin', { name: 'admin' }, function (tErr, nictag) {
        if (h.ifErr(t, tErr, 'nic tag creation')) {
            return t.end();
        }

        t.ok(nictag, 'nictag object returned');

        NAPI.updateNicTag('admin', { mtu: constants.MTU_NICTAG_MIN },
            function (err, obj, req, res) {
            t.ok(err, 'err returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [
                    mod_err.invalidParam('name', constants.ADMIN_UPDATE_MSG)
                ]
            }), 'Error body');

            // clean up 'admin' nictag, tested elsewhere.
            return NAPI.deleteNicTag('admin', function (err2) {
                t.ifError(err2, 'err cleaning up admin nic tag');
                t.end();
            });
        });
    });
});

test('update external nictag - name', function (t) {
    NAPI.createNicTag('external', { name: 'external' },
        function (tErr, nictag) {
        if (h.ifErr(t, tErr, 'nic tag creation')) {
            return t.end();
        }

        t.ok(nictag, 'nictag object returned');

        NAPI.updateNicTag('external', { name: 'mobile' },
            function (err, obj, req, res) {
            t.ok(err, 'err returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [
                    mod_err.invalidParam('name', constants.EXTERNAL_RENAME_MSG)
                ]
            }), 'Error body');

            return t.end();
        });
    });
});


test('Update nic tag - bogus MTU', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name,
            { name: curTag.name, mtu: 'foobar' },
            function (err, obj, req, res) {

            t.ok(err, 'error returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [ mod_err.invalidParam('mtu',
                        constants.MTU_NICTAG_INVALID_MSG) ]
            }), 'Error body');

            return t.end();
        });
    });
});

test('Update nic tag - with MTU < min', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name,
            { name: curTag.name, mtu: constants.MTU_NICTAG_MIN - 10 },
            function (err, obj, req, res) {
            // XXX do tests.
            t.ok(err, 'error returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [ mod_err.invalidParam('mtu',
                    constants.MTU_NICTAG_INVALID_MSG) ]
            }), 'Error body');

            return t.end();
        });
    });
});

test('Update nic tag - with MTU > max', function (t) {
    newTag(t, function (tErr, curTag) {
        if (h.ifErr(t, tErr, 'created new NIC tag')) {
            t.end();
            return;
        }

        NAPI.updateNicTag(curTag.name,
            { name: curTag.name, mtu: constants.MTU_MAX + 10 },
            function (err, obj, req, res) {
            // XXX do tests.
            t.ok(err, 'error returned');
            t.deepEqual(obj, null, 'no value returned');
            if (!err) {
                return t.end();
            }

            t.equal(err.statusCode, 422, 'status code');
            t.deepEqual(err.body, h.invalidParamErr({
                errors: [ mod_err.invalidParam('mtu',
                    constants.MTU_NICTAG_INVALID_MSG) ]
            }), 'Error body');

            return t.end();
        });
    });
});

test('Update nic tag - MTU < networks', function (t) {
    var tagName = 'networkmtutag';
    NAPI.createNicTag(tagName, { mtu: constants.MTU_MAX },
        function (err, obj) {
        if (h.ifErr(t, err, 'nic tag create')) {
            return t.end();
        }

        t.ok(obj, 'created NIC tag');

        var netParams = h.validNetworkParams({
            nic_tag: tagName,
            mtu: constants.MTU_MAX
        });
        NAPI.createNetwork(netParams, function (err2, net) {
            if (err2) {
                t.ifError(err2);
                return t.end();
            }
            t.ok(net, 'created network');
            NAPI.updateNicTag(tagName, { mtu: constants.MTU_DEFAULT },
                function (err3, _) {
                t.ok(err3, 'error returned');
                if (!err3) {
                    return t.end();
                }

                t.equal(err3.statusCode, 422, 'status code');
                t.deepEqual(err3.body, h.invalidParamErr({
                    errors: mod_err.nictagMtuInvalidForNetworks([net]),
                    message: 'Invalid parameters'
                }), 'Error body');
                t.end();
            });
        });
    });
});

// --- List Tests

function testTagList(t, opts, callback) {
    assert.object(t, 't');
    opts.type = 'ip';
    opts.reqType = 'list';
    NAPI.listNicTags(opts.params,
        common.afterAPIcall.bind(null, t, opts, callback));
}

test('Listing Nic Tag failures', function (t) {
    t.plan(common.badLimitOffTests.length);

    common.badLimitOffTests.forEach(function (blot) {
        t.test(blot.bc_name, function (t2) {
            testTagList(t2, {
                params: blot.bc_params,
                expCode: blot.bc_expcode,
                expErr: blot.bc_experr
            });
        });
    });
});


// --- Teardown


test('Stop server', mod_server.close);
