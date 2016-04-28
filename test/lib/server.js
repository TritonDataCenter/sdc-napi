/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI test server helpers
 */

'use strict';

var common = require('./common');
var config = require('./config');
var FakeWFclient = require('./mock-wf').FakeWFclient;
var log = require('./log');
var mock_moray = require('./mock-moray');
var mod_client = require('./client');
var NAPI = require('../../lib/napi').NAPI;



// --- Globals



var SERVER;



// --- Exports



/**
 * Close the server
 */
function closeServer(t) {
    if (!SERVER) {
        t.ok(true, 'no server to close');
        return t.end();
    }

    SERVER.stop(function (err) {
        t.ifErr(err, 'stopping server');
        return t.end();
    });
}


/**
 * Create the server then end the test
 */
function createServer(t) {
    createTestServer({}, function (err, res) {
        t.ifErr(err, 'creating server');
        if (err) {
            return t.end();
        }

        t.ok(res.server, 'server created');
        t.ok(res.client, 'client created');
        return t.end();
    });
}


/**
 * Create a test server
 */
function createTestServer(opts, callback) {
    var server = new NAPI({
        config: config.server,
        log: log.child({
            component: 'test-server'
        })
    });
    SERVER = server;

    server.wfapi = new FakeWFclient({ log: log });

    if (opts.unitTest) {
        server.initialDataLoaded = true;
        server.moray = new mock_moray.FakeMoray({ log: log });
    }

    server.on('connected', function _afterConnect() {
        log.debug('server connected');
        server.init();
    });

    server.on('initialized', function _afterReady() {
        log.debug('server initialized');

        var client = common.createClient(SERVER.info().url);
        mod_client.set(client);
        return callback(null, { server: SERVER, client: client });
    });

    server.start(function _afterStart(startErr) {
        log.debug('server started');
        if (startErr) {
            return callback(startErr);
        }

        if (opts.unitTest) {
            // This is normally emitted when the moray client connects, but
            // we have a mock moray client that doesn't actuall connect to
            // anything:
            server.emit('connected');
        }
    });
}



module.exports = {
    _create: createTestServer,
    close: closeServer,
    create: createServer,
    get: function () { return SERVER; }
};
