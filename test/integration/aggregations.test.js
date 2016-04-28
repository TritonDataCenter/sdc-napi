/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Integration tests for /aggregations endpoints
 */

'use strict';

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_aggr = require('../lib/aggr');
var mod_err = require('../../lib/util/errors');
var mod_nic = require('../lib/nic');
var test = require('tape');
var vasync = require('vasync');



// --- Globals



var NAPI = h.createNAPIclient(); // eslint-disable-line
var owner = 'd9a4394a-1fba-49dc-b81d-a8ac54ca8ffa';
var state = {
    aggrs: [],
    nics: []
};
var uuids = [
    'a1e38a64-85c6-41cc-bf7b-4d230ab84aa0',
    '755f4a24-397c-4885-bd67-08d8fe688fae'
];



// --- Setup



test('setup', function (t) {
    t.test('provision server0 nics', function (t2) {
        mod_nic.createN(t2, {
            state: state,
            stateProp: 'server0_nics',
            num: 5,
            params: {
                owner_uuid: owner,
                belongs_to_type: 'server',
                belongs_to_uuid: uuids[0]
            }
        });
    });


    t.test('provision server1 nics', function (t2) {
        mod_nic.createN(t2, {
            state: state,
            stateProp: 'server1_nics',
            num: 3,
            params: {
                owner_uuid: owner,
                belongs_to_type: 'server',
                belongs_to_uuid: uuids[1]
            }
        });
    });
});



// --- Create tests



test('create', function (t) {
    t.test('server0-aggr0', function (t2) {
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

        mod_aggr.create(t2, {
            state: state,
            params: params,
            exp: exp
        });
    });


    t.test('server0-aggr1', function (t2) {
        var params = {
            macs: [ state.nics[2].mac, state.nics[3].mac ],
            name: 'aggr1'
        };
        var exp = {
            belongs_to_uuid: uuids[0],
            lacp_mode: 'off',
            macs: params.macs,
            name: 'aggr1',
            id: mod_aggr.id(uuids[0], 'aggr1')
        };

        mod_aggr.create(t2, {
            state: state,
            params: params,
            exp: exp
        });
    });


    t.test('server1-aggr0', function (t2) {
        var params = {
            lacp_mode: 'passive',
            macs: [ state.nics[5].mac, state.nics[6].mac ],
            name: 'aggr0'
        };
        var exp = {
            belongs_to_uuid: uuids[1],
            lacp_mode: 'passive',
            macs: params.macs,
            name: 'aggr0',
            id: mod_aggr.id(uuids[1], 'aggr0')
        };

        mod_aggr.create(t2, {
            state: state,
            params: params,
            exp: exp
        });
    });


    t.test('invalid: duplicate server and name', function (t2) {
        mod_aggr.create(t2, {
            params: {
                macs: [ state.nics[0].mac, state.nics[1].mac ],
                name: 'aggr0'
            },
            expErr: h.invalidParamErr({
                errors: [ mod_err.duplicateParam('name',
                    constants.msg.AGGR_NAME) ]
            })
        });
    });
});



// --- Get tests



test('get', function (t) {
    t.test('all', function (t2) {
        vasync.forEachParallel({
            inputs: state.aggrs,
            func: function _get(aggr, cb) {
                mod_aggr.get(t2, { id: aggr.id, exp: aggr }, cb);
            }
        }, function () {
            return t2.end();
        });
    });
});



// --- List tests



test('list', function (t) {
    t.test('all', function (t2) {
        mod_aggr.list(t2, {}, function (err, list) {
            if (err) {
                return t2.end();
            }

            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            state.aggrs.forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t2.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t2.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t2.end();
        });
    });


    t.test('belongs_to_uuid filter: server0', function (t2) {
        mod_aggr.list(t2, { params: { belongs_to_uuid: uuids[0] } },
            function (err, list) {
            if (err) {
                return t2.end();
            }

            t2.equal(list.length, 2, '2 aggrs returned for server0');
            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            state.aggrs.slice(0, 1).forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t2.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t2.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t2.end();
        });
    });


    t.test('belongs_to_uuid filter: server1', function (t2) {
        mod_aggr.list(t2, { params: { belongs_to_uuid: uuids[1] } },
            function (err, list) {
            if (err) {
                return t2.end();
            }

            t2.equal(list.length, 1, '1 aggr returned for server1');
            t2.deepEqual(list[0], state.aggrs[2],
                'aggr for server1 is the same');
            return t2.end();
        });
    });


    t.test('macs filter: server0: nics[0]', function (t2) {
        mod_aggr.list(t2, { params: { macs: state.nics[0].mac } },
            function (err, list) {
            if (err) {
                return t2.end();
            }

            t2.equal(list.length, 1, '1 aggr returned');
            t2.deepEqual(list[0].id, state.aggrs[0].id,
                'correct aggr returned');
            return t2.end();
        });
    });


    t.test('macs filter: server0: nics[1]', function (t2) {
        mod_aggr.list(t2, { params: { macs: state.nics[1].mac } },
            function (err, list) {
            if (err) {
                return t2.end();
            }

            t2.equal(list.length, 1, '1 aggr returned');
            t2.deepEqual(list[0].id, state.aggrs[0].id,
                'correct aggr returned');
            return t2.end();
        });
    });


    t.test('macs filter: nics[1], nics[5]', function (t2) {
        mod_aggr.list(t2, { params: {
                macs: [state.nics[1].mac, state.nics[5].mac]
            } }, function (err, list) {
            if (err) {
                return t2.end();
            }

            t2.equal(list.length, 2, '2 aggrs returned');
            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            [state.aggrs[0], state.aggrs[2]].forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t2.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t2.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t2.end();
        });
    });
});



// --- Update tests



test('update', function (t) {
    t.test('server0-aggr0', function (t2) {
        var params = {
            lacp_mode: 'active',
            macs: state.aggrs[0].macs.concat(state.nics[4].mac)
        };
        for (var p in params) {
            state.aggrs[0][p] = params[p];
        }

        mod_aggr.update(t2, {
            id: state.aggrs[0].id,
            params: params,
            exp: state.aggrs[0]
        });
    });
});



// --- Teardown



test('teardown', function (t) {
    t.test('aggrs', function (t2) {
        if (state.aggrs.length === 0) {
            return t2.end();
        }

        vasync.forEachParallel({
            inputs: state.aggrs,
            func: function _delAggr(aggr, cb) {
                mod_aggr.del(t2, aggr, function (err) {
                    t2.ifError(err, 'deleted aggr');
                    return cb();
                });
            }

        }, function (err) {
            t2.ifError(err, 'deleted aggrs');
            return t2.end();
        });
    });

    t.test('nics', mod_nic.delAllCreated);
});
