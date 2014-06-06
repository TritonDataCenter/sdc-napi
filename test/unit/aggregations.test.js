/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Unit tests for aggregation endpoints
 */

var h = require('./helpers');
var clone = require('clone');
var constants = require('../../lib/util/constants');
var mod_aggr = require('../lib/aggr');
var mod_err = require('../../lib/util/errors');
var mod_nic = require('../lib/nic');
var mod_nic_tag = require('../lib/nic-tag');
var mod_uuid = require('node-uuid');
var util = require('util');
var util_mac = require('../../lib/util/mac');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var NAPI;
var owner = 'e597afe2-b4a6-4842-81d3-f5a7a98404b1';
var state = {
    nic_tags: []
};
var uuids = [
    mod_uuid.v4(),
    mod_uuid.v4(),
    mod_uuid.v4()
];



// --- Variables for invalid tests



var macMsg = 'must be an array of MAC addresses';
var arrMsg = 'must be an array';
var INVALID = {
    lacp_mode: [
        [ 5, 'must be a string' ],
        [ {}, 'must be a string' ],
        [ '', 'must not be empty' ],
        [ 'foo',
            'Invalid LACP mode. Supported modes: off, active, passive' ]
    ],

    macs: [
        [ 5, macMsg ],
        [ {}, macMsg ],
        [ '', 'must specify at least one MAC address' ],
        [ [ {} ], 'invalid MAC addresses', [ 'object' ] ],
        [ [ 6 ], 'invalid MAC addresses', [ 6 ] ]
    ],

    nic_tags_provided: [
        [ 5, arrMsg ],
        [ {}, arrMsg ],
        [ [ {} ], 'must be a string', [ {} ] ],
        [ [ 6 ], 'must be a string', [ 6 ] ],
        [ [ 'dne' ], 'nic tag does not exist', [ 'dne' ] ],
        [ [ 'dne1', 'dne2' ], 'nic tags do not exist', [ 'dne1', 'dne2' ] ]
    ]
};



// --- Internal helpers



/**
 * Takes a list of items to try for a parameter and the corresponding
 * expected error message. If param was 'name', list could be:
 *   [ [ '', 'must not be empty' ] ]
 */
function updateParamErrs(t, aggr, param, baseParams, list) {
    vasync.forEachParallel({
        inputs: list,
        func: function (item, cb) {
            var params = clone(baseParams);
            params[param] = item[0];

            var ipErr = mod_err.invalidParam(param, item[1]);
            if (item[2]) {
                ipErr.invalid = item[2];
            }

            mod_aggr.update(t, {
                id: aggr.id,
                params: params,
                expErr: h.invalidParamErr({
                    errors: [ ipErr ]
                })
            }, cb);
        }
    }, function () {
        return t.done();
    });
}


/**
 * Takes a list of items to try for a parameter and the corresponding
 * expected error message. If param was 'name', list could be:
 *   [ [ '', 'must not be empty' ] ]
 */
function createParamErrs(t, param, baseParams, list) {
    vasync.forEachParallel({
        inputs: list,
        func: function (item, cb) {
            var params = clone(baseParams);
            params[param] = item[0];

            var ipErr = mod_err.invalidParam(param, item[1]);
            if (item[2]) {
                ipErr.invalid = item[2];
            }

            mod_aggr.create(t, {
                params: params,
                expErr: h.invalidParamErr({
                    errors: [ ipErr ]
                })
            }, cb);
        }
    }, function () {
        return t.done();
    });
}



// --- Setup



exports['setup'] = {
    'create client and server': function (t) {
        h.createClientAndServer(function (err, res) {
            t.ifError(err, 'server creation');
            t.ok(res, 'client');
            NAPI = res;

            return t.done();
        });
    },


    'provision server0 nics': function (t) {
        mod_nic.createN(t, {
            state: state,
            stateProp: 'server0_nics',
            num: 5,
            params: {
                owner_uuid: owner,
                belongs_to_type: 'server',
                belongs_to_uuid: uuids[0]
            }
        });
    },


    'provision server1 nics': function (t) {
        mod_nic.createN(t, {
            state: state,
            stateProp: 'server1_nics',
            num: 3,
            params: {
                owner_uuid: owner,
                belongs_to_type: 'server',
                belongs_to_uuid: uuids[1]
            }
        });
    },


    'provision zone nics': function (t) {
        mod_nic.createN(t, {
            state: state,
            stateProp: 'zone_nics',
            num: 2,
            params: {
                owner_uuid: owner,
                belongs_to_type: 'zone',
                belongs_to_uuid: uuids[2]
            }
        });
    },


    'nic_tag1': function (t) {
        mod_nic_tag.create(t, {
            name: 'nic_tag1',
            state: state
        });
    },


    'nic_tag2': function (t) {
        mod_nic_tag.create(t, {
            name: 'nic_tag2',
            state: state
        });
    }
};



// --- Create tests



exports['create'] = {
    'server0-aggr0': function (t) {
        var params = {
            macs: [ state.nics[0].mac, state.nics[1].mac ],
            name: 'aggr0'
        };
        var exp = {
            belongs_to_uuid: uuids[0],
            id: mod_aggr.id(uuids[0], 'aggr0'),
            lacp_mode: 'off',
            macs: params.macs,
            name: 'aggr0'
        };

        mod_aggr.create(t, {
            state: state,
            params: params,
            exp: exp
        }, function (err, res) {
            if (err) {
                return t.done();
            }

            var morayObj = h.morayObj('napi_aggregations', exp.id);
            t.ok(morayObj, 'got moray object');
            res.macs = params.macs.map(function (m) {
                return util_mac.aton(m);
            });

            t.deepEqual(morayObj, res, 'raw moray object');
            return t.done();
        });
    },


    'server0-aggr1': function (t) {
        var params = {
            macs: [ state.nics[2].mac, state.nics[3].mac ],
            name: 'aggr1',
            nic_tags_provided: [ 'nic_tag1', 'nic_tag2' ]
        };
        var exp = {
            belongs_to_uuid: uuids[0],
            id: mod_aggr.id(uuids[0], 'aggr1'),
            lacp_mode: 'off',
            macs: params.macs,
            name: 'aggr1',
            nic_tags_provided: [ 'nic_tag1', 'nic_tag2' ]
        };

        mod_aggr.create(t, {
            state: state,
            params: params,
            exp: exp
        });
    },


    'server1-aggr0': function (t) {
        var params = {
            lacp_mode: 'passive',
            macs: [ state.nics[5].mac, state.nics[6].mac ],
            name: 'aggr0',
            nic_tags_provided: ''
        };
        var exp = {
            belongs_to_uuid: uuids[1],
            lacp_mode: 'passive',
            macs: params.macs,
            name: 'aggr0',
            id: mod_aggr.id(uuids[1], 'aggr0')
        };

        mod_aggr.create(t, {
            state: state,
            params: params,
            exp: exp
        });
    },


    'invalid: missing properties': function (t) {
        mod_aggr.create(t, {
            state: state,
            params: { },
            expErr: h.missingParamErr({
                errors: [
                    h.missingParam('macs'),
                    h.missingParam('name')
                ]
            })
        });
    },


    'invalid: lacp_mode': function (t) {
        createParamErrs(t, 'lacp_mode', {
            macs: [ state.nics[4].mac ],
            name: 'aggr3'
        }, INVALID.lacp_mode);
    },


    'invalid: name': function (t) {
        var tenAs = 'aaaaaaaaaa';
        var invalid = [
            [ 5, 'must be a string' ],
            [ {}, 'must be a string' ],
            [ '', 'must not be empty' ],
            [ 'f-oo0',
                'must only contain numbers, letters and underscores' ],
            [ 'foo', 'must end in a number' ],
            [ tenAs + tenAs + tenAs + 'aa',
                'must not be longer than 31 characters' ]
        ];

        createParamErrs(t, 'name', {
            macs: [ state.nics[4].mac ]
        }, invalid);
    },


    'invalid: macs': function (t) {
        createParamErrs(t, 'macs', {
            name: 'aggr4'
        }, INVALID.macs);
    },


    'invalid: nic_tags_provided': function (t) {
        createParamErrs(t, 'nic_tags_provided', {
            macs: [ state.nics[4].mac ],
            name: 'aggr5'
        }, INVALID.nic_tags_provided);
    },


    'invalid: belongs_to_uuid not matching': function (t) {
        mod_aggr.create(t, {
            params: {
                macs: [ state.nics[4].mac, state.nics[7].mac ],
                name: 'aggr2'
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.invalidParam('macs', constants.msg.AGGR_MATCH) ]
            })
        });
    },

    'invalid: nic has wrong belongs_to_type': function (t) {
        var macs = [ state.zone_nics[0].mac, state.zone_nics[1].mac ];

        mod_aggr.create(t, {
            params: {
                macs: macs,
                name: 'aggr2'
            },
            expErr: h.invalidParamErr({
                errors: [ mod_err.invalidParam('macs',
                    constants.msg.AGGR_BELONGS, { invalid: macs }) ]
            })
        });
    },


    'invalid: duplicate server and name': function (t) {
        mod_aggr.create(t, {
            params: {
                macs: [ state.nics[0].mac, state.nics[1].mac ],
                name: 'aggr0'
            },
            expErr: h.invalidParamErr({
                errors: [
                    mod_err.duplicateParam('name', constants.msg.AGGR_NAME)
                ]
            })
        });
    }

    // XXX: nic in use by another aggr
    // XXX: nic tag in use by another aggr
};



// --- Get tests



exports['get'] = {
    'all': function (t) {
        vasync.forEachParallel({
            inputs: state.aggrs,
            func: function _get(aggr, cb) {
                mod_aggr.get(t, { id: aggr.id, exp: aggr }, cb);
            }
        }, function () {
            return t.done();
        });
    },


    'missing': function (t) {
        mod_aggr.get(t, {
            id: 'aggr9',
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'aggregation not found'
            }
        });
    }
};



// --- List tests



exports['list'] = {
    'all': function (t) {
        mod_aggr.list(t, {}, function (err, list) {
            if (err) {
                return t.done();
            }

            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            state.aggrs.forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t.done();
        });
    },

    'belongs_to_uuid filter: server0': function (t) {
        mod_aggr.list(t, { params: { belongs_to_uuid: uuids[0] } },
            function (err, list) {
            if (err) {
                return t.done();
            }

            t.equal(list.length, 2, '2 aggrs returned for server0');
            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            state.aggrs.slice(0, 1).forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t.done();
        });
    },

    'belongs_to_uuid filter: server1': function (t) {
        mod_aggr.list(t, { params: { belongs_to_uuid: uuids[1] } },
            function (err, list) {
            if (err) {
                return t.done();
            }

            t.equal(list.length, 1, '1 aggr returned for server1');
            t.deepEqual(list[0], state.aggrs[2],
                'aggr for server1 is the same');
            return t.done();
        });
    }

    // XXX: filter by nic_tags_provided
};



// --- Update tests



exports['update'] = {
    'server0-aggr0': function (t) {
        var params = {
            lacp_mode: 'active',
            macs: state.aggrs[0].macs.concat(state.nics[4].mac)
        };
        for (var p in params) {
            state.aggrs[0][p] = params[p];
        }

        mod_aggr.update(t, {
            id: state.aggrs[0].id,
            params: params,
            exp: state.aggrs[0]
        });
    },


    'server0-aggr0: get updated': function (t) {
        mod_aggr.get(t, {
            id: state.aggrs[0].id,
            exp: state.aggrs[0]
        });
    },

    'update id': function (t) {
        mod_aggr.update(t, {
            id: state.aggrs[0].id,
            params: {
                id: mod_aggr.id(uuids[0], 'aggr9')
            },
            // Should be unchanged
            exp: state.aggrs[0]
        });
    },

    'update name': function (t) {
        mod_aggr.update(t, {
            id: state.aggrs[0].id,
            params: {
                name: 'aggr9'
            },
            // Should be unchanged
            exp: state.aggrs[0]
        });
    },

    'invalid: lacp_mode': function (t) {
        updateParamErrs(t, state.aggrs[0], 'lacp_mode', {
            macs: [ state.nics[4].mac ],
            name: 'aggr3'
        }, INVALID.lacp_mode);
    },


    'invalid: nic_tags_provided': function (t) {
        updateParamErrs(t, state.aggrs[0], 'nic_tags_provided', {
            name: 'aggr4'
        }, INVALID.nic_tags_provided);
    },


    'invalid: macs': function (t) {
        updateParamErrs(t, state.aggrs[0], 'macs', {
            name: 'aggr4'
        }, INVALID.macs);
    }

    // XXX: tests
    // * include a mac in a different aggr
    // * mac that's on a different server
    // * from all server0 macs to all server1 macs
};



// --- Delete tests



exports['delete'] = {
    'all': function (t) {
        vasync.forEachParallel({
            inputs: state.aggrs,
            func: function _del(aggr, cb) {
                mod_aggr.del(t, aggr, function (err, res) {
                    return cb();
                });
            }
        }, function () {
            return t.done();
        });
    },


    'missing': function (t) {
        mod_aggr.del(t, {
            id: mod_aggr.id(uuids[0], 'aggr9'),
            expCode: 404,
            expErr: {
                code: 'ResourceNotFound',
                message: 'aggregation not found'
            }
        });
    }
};



// --- Teardown



exports['teardown'] = function (t) {
    h.stopServer(function (err) {
        t.ifError(err, 'server stop');
        return t.done();
    });
};



// Use to run only one test in this file:
if (runOne) {
    module.exports = {
        setup: exports.setup,
        setUp: exports.setUp,
        oneTest: runOne,
        teardown: exports.teardown
    };
}
