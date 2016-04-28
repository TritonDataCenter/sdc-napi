/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * The Networking API application
 */

'use strict';

var assert = require('assert-plus');
var constants = require('./util/constants');
var endpoints = require('./endpoints');
var EffluentLogger = require('effluent-logger');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var https = require('https');
var models = require('./models');
var mod_config = require('./config');
var mod_init = require('./init');
var mod_migrate = require('./migrate.js');
var moray = require('moray');
var os = require('os');
var restify = require('restify');
var trace_event = require('trace-event');
var util = require('util');
var verror = require('verror');



// --- Globals



var PKG = require('../package.json');
var request_seq_id = 0;



// --- NAPI object and methods



/**
 * NAPI constructor
 */
function NAPI(opts) {
    var self = this;
    this.log = opts.log;
    this.config = opts.config;
    this.initialDataLoaded = false;
    constants.UFDS_ADMIN_UUID = opts.config.ufdsAdminUuid;

    if (opts.config.overlay.enabled) {

        if (opts.config.overlay.defaultOverlayMTU === undefined ||
            opts.config.overlay.overlayNicTag === undefined ||
            opts.config.overlay.underlayNicTag === undefined) {
                throw new verror.VError('SAPI overlay configuration ' +
                    'incomplete. Missing one of deafultOverlayMTU, ' +
                    'overlayNicTag, underlayNicTag. Found: %j',
                    opts.config.overlay);
        }

        constants.FABRICS_ENABLED = true;
        constants.OVERLAY_MTU = opts.config.overlay.defaultOverlayMTU;
        constants.OVERLAY_TAG = opts.config.overlay.overlayNicTag;
        constants.UNDERLAY_TAG = opts.config.overlay.underlayNicTag;
    }

    var maxSockets = opts.config.maxHttpSockets || 100;
    opts.log.debug('Setting maxSockets to %d', maxSockets);
    http.globalAgent.maxSockets = maxSockets;
    https.globalAgent.maxSockets = maxSockets;

    function populateReq(req, res, next) {
        req.config = opts.config;
        req.app = self;
        return next();
    }

    function checkServices(req, res, next) {
        if (!req.app.moray) {
            return next(new restify.ServiceUnavailableError(
                'Moray client not initialized'));
        }

        if (!req.app.initialDataLoaded) {
            return next(new restify.ServiceUnavailableError(
                'Initial network data not loaded'));
        }

        return next();
    }

    var before = [ populateReq, checkServices ];
    var server = this.server = restify.createServer({
        log: opts.log,
        name: PKG.description,
        version: PKG.version
    });

    /*
     * The EVT route must be first to ensure that we always have the req.trace
     * for later use. However it must come after the request logger. We need the
     * request logger to come first as it's installing the req_id that we end up
     * using elsewhere.
     */
    server.use(restify.requestLogger());
    var EVT_SKIP_ROUTES = {
        'getping': true,
        'headping': true
    };
    server.use(function (req, res, next) {
        req.trace = trace_event.createBunyanTracer({
            log: req.log
        });
        if (req.route && !EVT_SKIP_ROUTES[req.route.name]) {
            request_seq_id = (request_seq_id + 1) % 1000;
            req.trace.seq_id = (req.time() * 1000) + request_seq_id;
            req.trace.begin({name: req.route.name, req_seq: req.trace.seq_id});
        }
        next();
    });

    server.use(function (req, res, next) {
        res.on('header', function onHeader() {
            var now = Date.now();
            res.header('Date', new Date());
            res.header('Server', server.name);
            res.header('x-request-id', req.getId());
            var t = now - req.time();
            res.header('x-response-time', t);
            res.header('x-server-name', os.hostname());
        });
        next();
    });

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.queryParser());
    server.use(restify.bodyParser());

    server.on('after', function (req, res, route, _err) {
        if (route && !EVT_SKIP_ROUTES[route.name]) {
            req.trace.end({ name: route.name, req_seq: req.trace.seq_id });
        }
    });

    server.on('after', function _filteredAuditLog(req, res, route, err) {
        // Don't log ping requests, to avoid filling up the log
        if (route && (route.name === 'getping' || route.name === 'headping')) {
            return;
        }

        restify.auditLogger({
            log: req.log.child({
                component: 'audit',
                route: route && route.name
            }, true),
            // Successful GET res bodies are uninteresting and *big*.
            body: !((req.method === 'GET') &&
                Math.floor(res.statusCode / 100) === 2)
        })(req, res, route, err);
    });

    server.on('uncaughtException', function (req, res, route, err) {
        res.send(new verror.WError(err, 'Internal error'));
        restify.auditLogger({
            log: req.log.child({
                component: 'audit',
                route: route && route.name
            }, true)
        })(req, res, route, err);
    });

    endpoints.registerEndpoints(server, this.log, before);
}

util.inherits(NAPI, EventEmitter);


/**
 * Starts the server
 */
NAPI.prototype.start = function start(callback) {
    this.server.on('error', callback);
    this.server.listen(this.config.port, callback);

    if (!this.moray) {
        this.createMorayClient();
    }
};


/**
 * Stops the server
 */
NAPI.prototype.stop = function stop(callback) {
    var self = this;
    this.server.close(function (err) {
        if (self.moray) {
            self.moray.close();
        }

        return callback(err);
    });
};


/**
 * Returns connection info for the server
 */
NAPI.prototype.info = function info() {
    if (!this.server) {
        return {};
    }

    return {
        name: this.server.name,
        port: this.config.port,
        url: this.server.url
    };
};



// --- Setup and validation



/**
 * Populates initial network data from the config file
 */
NAPI.prototype.loadInitialData = function loadInitialData(callback) {
    var self = this;
    mod_init.loadInitialData({
        app: this,
        config: this.config,
        log: this.log.child({ component: 'init' })
    }, function _afterLoad() {
        self.initialDataLoaded = true;
        return callback();
    });
};


/**
 * Creates a moray client, retrying as necessary
 */
NAPI.prototype.createMorayClient = function createMorayClient() {
    var self = this;
    var conf = {
        connectTimeout: 1000,
        host: self.config.moray.host,
        noCache: true,
        port: self.config.moray.port,
        reconnect: true,
        retry: {
            retries: Infinity,
            maxTimeout: 6000,
            minTimeout: 100
        }
    };

    self.log.debug(conf, 'Creating moray client');
    conf.log = self.log.child({
        component: 'moray',
        level: self.config.moray.logLevel || 'info'
    });
    var client = moray.createClient(conf);

    function onMorayConnect() {
        client.removeListener('error', onMorayError);
        client.log.info('moray: connected');
        self.morayConnected = true;
        self.moray = client;
        self.emit('connected');

        client.on('close', function () {
            client.log.error('moray: closed');
            self.morayConnected = false;
        });

        client.on('connect', function () {
            client.log.info('moray: reconnected');
            self.morayConnected = true;
        });

        client.on('error', function (err) {
            client.log.warn(err, 'moray: error (reconnecting)');
            self.morayConnected = false;
        });
    }

    function onMorayError(err) {
        client.removeListener('connect', onMorayConnect);
        self.morayConnected = false;
        client.log.error(err, 'moray: connection failed');
    }

    function onMorayConnectAttempt(number, delay) {
        var level;
        if (number === 0) {
            level = 'info';
        } else if (number < 5) {
            level = 'warn';
        } else {
            level = 'error';
        }
        client.log[level]({
                attempt: number,
                delay: delay
        }, 'moray: connection attempted');
    }

    client.once('connect', onMorayConnect);
    client.once('error', onMorayError);
    client.on('connectAttempt', onMorayConnectAttempt); // this we always use
};


/**
 * Do any outstanding migrations
 */
NAPI.prototype.doMigrations = function doMigrations(callback) {
    var opts = {
        app: this,
        log: this.log.child({ component: 'migrate' }),
        models: models.models
    };
    mod_migrate.migrateAll(opts, callback);
};


/**
 * Initializes moray buckets
 */
NAPI.prototype.init = function serverInit() {
    var self = this;
    var att = 1;
    var timeout = null;

    function modelInitRetry() {
        models.init(self, function (err) {
            if (timeout) {
                clearTimeout(timeout);
            }

            if (err) {
                self.log.error(err, 'Error initializing models (attempt=%d)',
                    att);
                att++;
                timeout = setTimeout(modelInitRetry, 10000);
                return;
            }

            self.emit('initialized');
        });
    }

    // node-moray's version API returns the version as the first argument of the
    // callback (and never returns an error)
    this.moray.version({ log: self.moray.log }, function (v) {
        self.morayVersion = v;
        modelInitRetry();
    });
};


/**
 * If we're logging events to fluentd, set that up now
 */
function addFluentdHost(log, host) {
    var evtLogger = new EffluentLogger({
        filter: function _evtFilter(obj) { return (!!obj.evt); },
        host: host,
        log: log,
        port: 24224,
        tag: 'debug'
    });
    log.addStream({
        stream: evtLogger,
        type: 'raw'
    });
}


/**
 * Creates a new NAPI server
 */
function createServer(opts) {
    assert.object(opts, 'opts');
    assert.object(opts.log, 'opts.log');
    assert.string(opts.configFile, 'opts.configFile');

    opts.log.info('Loading config from "%s"', opts.configFile);
    var config = mod_config.load(opts.configFile);

    if (config.hasOwnProperty('logLevel')) {
        opts.log.info('Setting log level to "%s"', config.logLevel);
        opts.log.level(config.logLevel);
    }

    // EXPERIMENTAL
    if (config.fluentd_host) {
        addFluentdHost(opts.log, config.fluentd_host);
    }

    return new NAPI({
        log: opts.log,
        config: config
    });
}



// --- Exports

module.exports = {
    createServer: createServer,
    NAPI: NAPI
};
