/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2017, Joyent, Inc.
 */

/*
 * Endpoints for managing and getting info about the running NAPI server.
 */

'use strict';

var restify = require('restify');


// --- Globals

var USAGE_PERIOD = 8 * 60 * 60 * 1000; // 8 hours


// --- Internal

function doCollection() {
    var start = process.memoryUsage();
    start.time = Date.now();

    /*
     * A single gc() call doesn't run to completion, so we call it
     * twice to make a larger dent in the heap.
     */
    global.gc();
    global.gc();

    var end = process.memoryUsage();
    end.time = Date.now();

    return { start: start, end: end };
}


function periodicUsageLog(log) {
    var info = process.memoryUsage();
    log.info({ memory: info }, 'Current memory usage');
}


// --- Endpoints

function runGC(req, res, next) {
    if (global.gc) {
        res.send(200, doCollection());
        next();
    } else {
        next(new restify.NotImplementedError('GC not exposed to NAPI'));
    }
}


function register(http, before, log) {
    log.info({ period: USAGE_PERIOD },
        'Starting periodic logging of memory usage');
    setInterval(periodicUsageLog, USAGE_PERIOD, log);

    http.get({ path: '/manage/gc', name: 'RunGC' },
        before, runGC);
    http.head({ path: '/manage/gc', name: 'RunGC' },
        before, runGC);
}


module.exports = {
    register: register
};
