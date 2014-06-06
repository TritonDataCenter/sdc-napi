/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /aggregations endpoints
 */

var constants = require('../../lib/util/constants');
var h = require('./helpers');
var mod_aggr = require('../lib/aggr');
var mod_err = require('../../lib/util/errors');
var mod_nic = require('../lib/nic');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var NAPI = h.createNAPIclient();
var owner = 'd9a4394a-1fba-49dc-b81d-a8ac54ca8ffa';
var state = {
    aggrs: [],
    nics: []
};
var uuids = [
    'a1e38a64-85c6-41cc-bf7b-4d230ab84aa0',
    '755f4a24-397c-4885-bd67-08d8fe688fae'
];



// --- Helpers



/**
 * Create an aggregation, but expect an error
 */
function expCreateErr(t, params, expErr, callback) {
    mod_aggr.create(t, state, params, { expectError: true },
        function (err, res) {
        if (!err) {
            t.deepEqual(res, {}, 'res should not exist');
            return t.done();
        }

        t.deepEqual(err.body, h.invalidParamErr({
            errors: [ expErr ],
            message: 'Invalid parameters'
        }), 'Error body');

        if (callback) {
            return callback();
        } else {
            return t.done();
        }
    });
}



// --- Setup



exports['setup'] = {
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
        });
    },


    'server0-aggr1': function (t) {
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
            name: 'aggr0'
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


    'invalid: duplicate server and name': function (t) {
        mod_aggr.create(t, {
            params: {
                macs: [ state.nics[0].mac, state.nics[1].mac ],
                name: 'aggr0'
            },
            expErr: h.invalidParamErr({
                errors: [ mod_err.duplicateParam('name',
                    constants.msg.AGGR_NAME) ]
            })
        });
    }
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
    },


    'macs filter: server0: nics[0]': function (t) {
        mod_aggr.list(t, { params: { macs: state.nics[0].mac } },
            function (err, list) {
            if (err) {
                return t.done();
            }

            t.equal(list.length, 1, '1 aggr returned');
            t.deepEqual(list[0].id, state.aggrs[0].id,
                'correct aggr returned');
            return t.done();
        });
    },


    'macs filter: server0: nics[1]': function (t) {
        mod_aggr.list(t, { params: { macs: state.nics[1].mac } },
            function (err, list) {
            if (err) {
                return t.done();
            }

            t.equal(list.length, 1, '1 aggr returned');
            t.deepEqual(list[0].id, state.aggrs[0].id,
                'correct aggr returned');
            return t.done();
        });
    },


    'macs filter: nics[1], nics[5]': function (t) {
        mod_aggr.list(t, { params: {
                macs: [state.nics[1].mac, state.nics[5].mac]
            } }, function (err, list) {
            if (err) {
                return t.done();
            }

            t.equal(list.length, 2, '2 aggrs returned');
            var ids = list.map(function (listAg) {
                return listAg.id;
            });

            [state.aggrs[0], state.aggrs[2]].forEach(function (ag) {
                var idx = ids.indexOf(ag.id);
                t.notEqual(idx, -1, 'aggr ' + ag.id + ' found in list');
                if (idx !== -1) {
                    t.deepEqual(list[idx], ag, 'aggr ' + ag.id
                        + ' in list is the same');
                }
            });

            return t.done();
        });
    }
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
    }
};



// --- Teardown



exports['teardown'] = {
    'aggrs': function (t) {
        if (state.aggrs.length === 0) {
            return t.done();
        }

        vasync.forEachParallel({
            inputs: state.aggrs,
            func: function _delAggr(aggr, cb) {
                mod_aggr.del(t, aggr, function (err) {
                    return cb();
                });
            }

        }, function (err) {
            return t.done();
        });
    },


    'nics': function (t) {
        if (state.nics.length === 0) {
            return t.done();
        }

        vasync.forEachParallel({
            inputs: state.nics,
            func: function _delNic(nic, cb) {
                mod_nic.del(t, nic, function (err) {
                    return cb();
                });
            }
        }, function (err) {
            return t.done();
        });
    }
};
