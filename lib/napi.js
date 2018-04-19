/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * The Networking API application
 */

'use strict';

var assert = require('assert-plus');
var constants = require('./util/constants');
var createMetricsManager = require('triton-metrics').createMetricsManager;
var endpoints = require('./endpoints');
var EffluentLogger = require('effluent-logger');
var http = require('http');
var https = require('https');
var models = require('./models');
var mod_apis_moray = require('./apis/moray');
var mod_changefeed = require('changefeed');
var mod_config = require('./config');
var mod_init = require('./init');
var mod_jsprim = require('jsprim');
var mod_migrate = require('./migrate.js');
var mod_mooremachine = require('mooremachine');
var moray = require('moray');
var os = require('os');
var restify = require('restify');
var trace_event = require('trace-event');
var util = require('util');
var VError = require('verror');


// --- Globals


var METRICS_SERVER_PORT = 8881;
var NAPI_CHANGEFEED_BUCKET = 'napi_changes';
var USAGE_PERIOD = 8 * 60 * 60 * 1000; // 8 hours
var PKG = require('../package.json');
var request_seq_id = 0;


// --- Internal functions


function periodicUsageLog(log) {
    log.info({ memory: process.memoryUsage() },
        'Current memory usage');
}


// --- NAPI object and methods



/**
 * NAPI constructor
 */
function NAPI(opts) {
    var self = this;
    this.log = opts.log;
    this.config = opts.config;
    constants.UFDS_ADMIN_UUID = opts.config.ufdsAdminUuid;

    if (opts.config.overlay.enabled) {

        if (opts.config.overlay.defaultOverlayMTU === undefined ||
            opts.config.overlay.overlayNicTag === undefined ||
            opts.config.overlay.underlayNicTag === undefined) {
                throw new VError('SAPI overlay configuration ' +
                    'incomplete. Missing one of deafultOverlayMTU, ' +
                    'overlayNicTag, underlayNicTag. Found: %j',
                    opts.config.overlay);
        }

        constants.FABRICS_ENABLED = true;
        constants.OVERLAY_MTU = opts.config.overlay.defaultOverlayMTU;
        constants.OVERLAY_TAG = opts.config.overlay.overlayNicTag;
        constants.UNDERLAY_TAG = opts.config.overlay.underlayNicTag;
    }

    if (opts.config.bucketPrefix) {
        mod_apis_moray.setTestPrefix(
            opts.config.bucketPrefix.replace(/-/g, '_'));
    }

    var maxSockets = opts.config.maxHttpSockets || 100;
    opts.log.debug('Setting maxSockets to %d', maxSockets);
    http.globalAgent.maxSockets = maxSockets;
    https.globalAgent.maxSockets = maxSockets;

    this.metricsManager = createMetricsManager({
        address: opts.config.adminIp,
        log: opts.log.child({component: 'metrics'}),
        port: METRICS_SERVER_PORT,
        restify: restify,
        staticLabels: {
            datacenter: opts.config.datacenter,
            instance: opts.config.instanceUuid,
            server: opts.config.serverUuid,
            service: opts.config.serviceName
        }
    });

    this.metricsManager.createRestifyMetrics();
    this.metricsManager.listen(function metricsServerStarted() {});

    function populateReq(req, res, next) {
        req.config = opts.config;
        req.app = self;
        return next();
    }

    function checkServices(req, res, next) {
        if (!req.app.isInState('running')) {
            next(new restify.ServiceUnavailableError(
                'Server is still initializing'));
            return;
        }

        next();
    }

    var before = [ populateReq, checkServices ];
    var server = this.server = restify.createServer({
        log: opts.log,
        name: PKG.description,
        handleUncaughtExceptions: false,
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

    server.on('after', function (req, res, route) {
        self.metricsManager.collectRestifyMetrics(req, res, route);
    });

    endpoints.registerEndpoints(server, before, this.log);

    mod_mooremachine.FSM.call(this, 'waiting');
}

util.inherits(NAPI, mod_mooremachine.FSM);


/**
 * Starts the server
 */
NAPI.prototype.start = function start(callback) {
    this.server.on('error', callback);
    this.server.listen(this.config.port, callback);

    this.emit('startAsserted');
};


/**
 * Stops the server
 */
NAPI.prototype.stop = function stop(callback) {
    assert.ok(this.isInState('running'));
    this.emit('stopAsserted', callback);
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


NAPI.prototype.state_waiting = function (S) {
    S.validTransitions([ 'init' ]);

    S.on(this, 'startAsserted', function () {
        S.gotoState('init');
    });
};

NAPI.prototype.state_init = function (S) {
    S.gotoState('init.memlogger');
};

NAPI.prototype.state_init.memlogger = function (S) {
    this.log.info({ period: USAGE_PERIOD },
        'Starting periodic logging of memory usage');
    this.usageTimer = setInterval(periodicUsageLog, USAGE_PERIOD, this.log);
    S.gotoState('init.moray');
};

NAPI.prototype.state_init.moray = function (S) {
    var self = this;

    S.validTransitions([ 'init.buckets', 'failed' ]);

    if (self.moray) {
        S.gotoState('init.buckets');
        return;
    }

    var conf = mod_jsprim.deepCopy(self.config.moray);

    self.log.debug(conf, 'Creating moray client');

    conf.log = self.log.child({
        component: 'moray',
        level: self.config.moray.logLevel || 'info'
    });

    self.moray = moray.createClient(conf);

    S.on(self.moray, 'connect', function onMorayConnect() {
        self.log.info('moray: connected');

        S.gotoState('init.buckets');
    });

    S.on(self.moray, 'error', function onMorayError(err) {
        self.initErr = new VError(err, 'moray: connection failed');
        S.gotoState('failed');
    });
};

NAPI.prototype.state_init.buckets = function (S) {
    var self = this;

    S.validTransitions([ 'init.buckets', 'init.migrations' ]);

    /*
     * There's no good way to deal with Moray versions currently (see RFD 33
     * for a discussion of this), so for now we just hardcode version 2 until
     * we have a way to enforce talking to a minimum Moray version.
     */
    self.morayVersion = 2;

    models.init(self, function (err) {
        if (err) {
            self.log.error(err, 'Error initializing models; retrying in 10s');
            S.timeout(10000, function () {
                S.gotoState('init.buckets');
            });
            return;
        }

        S.gotoState('init.migrations');
    });
};

NAPI.prototype.state_init.migrations = function (S) {
    var self = this;

    S.validTransitions([ 'init.publisher', 'failed' ]);

    mod_migrate.migrateAll({
        app: self,
        log: self.log.child({ component: 'migrate' }),
        models: models.models
    }, function afterMigrate(err) {
        if (err) {
            self.initErr = new VError(err, 'failed to migrate data');
            S.gotoState('failed');
            return;
        }

        self.log.info('Migrations complete');
        S.gotoState('init.publisher');
    });
};

NAPI.prototype.state_init.publisher = function (S) {
    var self = this;

    S.validTransitions([ 'init.loadInitialData', 'failed' ]);

    self.publisher = mod_changefeed.createPublisher({
        backoff: {
            maxTimeout: Infinity,
            minTimeout: 10,
            retries: Infinity
        },
        log: self.log.child({ component: 'changefeed' }),
        maxAge: 2000,
        moray: {
            bucketName: NAPI_CHANGEFEED_BUCKET,
            client: self.moray
        },
        restifyServer: self.server,
        resources: [
            {
                bootstrapRoute: '/aggregations',
                resource: 'aggregation',
                subResources: [
                    'create',
                    'delete',
                    'lacp_mode'
                ]
            },
            {
                bootstrapRoute: '/networks',
                resource: 'network',
                subResources: [
                    'create',
                    'delete',
                    'gateway',
                    'resolvers',
                    'routes'
                ]
            },
            {
                bootstrapRoute: '/nics',
                resource: 'nic',
                subResources: [
                    'create',
                    'delete',
                    'allow_dhcp_spoofing',
                    'allow_ip_spoofing',
                    'allow_mac_spoofing',
                    'allow_restricted_traffic',
                    'allow_unfiltered_promisc',
                    'primary'
                ]
            }
        ]
    });

    self.publisher.start();

    S.on(self.publisher, 'moray-ready', function () {
        S.gotoState('init.loadInitialData');
    });

    S.on(self.publisher, 'moray-fail', function () {
        self.initErr = new VError('changefeed failed to setup moray buckets');
        S.gotoState('failed');
    });
};

NAPI.prototype.state_init.loadInitialData = function (S) {
    var self = this;

    S.validTransitions([ 'running' ]);

    mod_init.loadInitialData({
        app: self,
        config: self.config,
        log: self.log
    }, function _afterLoad() {
        self.log.info('Initial data loaded');
        S.gotoState('running');
    });
};

NAPI.prototype.state_running = function (S) {
    var self = this;

    S.validTransitions([ 'stopping' ]);

    S.on(self, 'stopAsserted', function (callback) {
        self.stopcb = callback;
        S.gotoState('stopping');
    });

    S.immediate(function () {
        self.emit('initialized');
    });
};

NAPI.prototype.state_failed = function (S) {
    var self = this;

    S.validTransitions([]);

    self._cleanup(function () {
        self.emit('error', self.initErr);
    });
};

NAPI.prototype.state_stopping = function (S) {
    var self = this;

    S.validTransitions([ 'stopped' ]);

    self._cleanup(function (err) {
        self.stoperr = err;
        S.gotoState('stopped');
    });
};

NAPI.prototype.state_stopped = function (S) {
    S.validTransitions([]);
    setImmediate(this.stopcb, this.stoperr);
};

NAPI.prototype._cleanup = function (callback) {
    var self = this;

    function onMetricsClose() {
        self.server.close(onServerClose);
    }

    function onServerClose(err) {
        if (self.publisher) {
            self.publisher.stop();
        }

        if (self.moray) {
            self.moray.close();
        }

        if (self.usageTimer) {
            clearInterval(self.usageTimer);
            self.usageTimer = null;
        }

        if (callback) {
            callback(err);
        }
    }

    this.metricsManager.close(onMetricsClose);
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
