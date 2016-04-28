/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Mock workflow client
 */

'use strict';

var assert = require('assert-plus');
var mod_uuid = require('node-uuid');



// --- Globals



var JOBS = [];



// --- Fake workflow client object



function FakeWFclient(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');

    this.log = opts.log;
}


FakeWFclient.prototype.createJob = function createJob(name, params, callback) {
    var uuid = mod_uuid.v4();
    JOBS.push({
        uuid: uuid,
        name: name,
        params: params
    });

    process.nextTick(function () {
        return callback(null, { uuid: uuid });
    });
};



module.exports = {
    FakeWFclient: FakeWFclient,
    get jobs() {
        return JOBS;
    },
    set jobs(val) {
        JOBS = val;
    }
};
