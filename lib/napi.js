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

var assert = require('assert-plus');
var clone = require('clone');
var constants = require('./util/constants');
var endpoints = require('./endpoints');
var errors = require('./util/errors');
var fs = require('fs');
var EventEmitter = require('events').EventEmitter;
var http = require('http');
var https = require('https');
var models = require('./models');
var mod_config = require('./config');
var mod_init = require('./init');
var mod_net = require('./models/network');
var mod_nicTag = require('./models/nic-tag');
var mod_migrate = require('./migrate.js');
var moray = require('moray');
var os = require('os');
var restify = require('restify');
var trace_event = require('trace-event');
var util = require('util');
var verror = require('verror');
var WFAPI = require('wf-client');



// --- Globals



var VERSION = require('../package.json').version;



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

    if (opts.config.overlay.overlayNicTag) {
        constants.OVERLAY_TAG = opts.config.overlay.overlayNicTag;
    }

    if (opts.config.overlay.underlayNicTag) {
        constants.FABRICS_ENABLED = true;
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

        if (!req.app.wfapi) {
            return next(new restify.ServiceUnavailableError(
                'Workflow client not initialized'));
        }

        return next();
    }

    var before = [ populateReq, checkServices ];
    var server = this.server = restify.createServer({
        log: opts.log,
        name: 'SmartDC Network API',
        version: VERSION
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
    server.use(restify.authorizationParser());
    server.use(restify.queryParser());
    server.use(restify.bodyParser());
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
            req.trace.begin(req.route.name);
        }
        next();
    });
    server.on('after', function (req, res, route, err) {
        if (route && !EVT_SKIP_ROUTES[route.name]) {
            req.trace.end(route.name);
        }
    });

    server.on('after', function _filteredAuditLog(req, res, route, err) {
        // Don't log ping requests, to avoid filling up the log
        if (route && (route.name == 'getping' || route.name == 'headping')) {
            return;
        }

        restify.auditLogger({
            log: req.log.child({
                component: 'audit',
                route: route && route.name
            }, true),
            // Successful GET res bodies are uninteresting and *big*.
            body: !((req.method === 'GET') &&
                Math.floor(res.statusCode/100) === 2)
        })(req, res, route, err);
    });

    server.on('uncaughtException', function (req, res, route, err) {
        req.log.error(err, 'Uncaught exception');
        res.send(new verror.WError(err, 'Internal error'));
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

    if (!this.wfapi) {
        this.createWorkflowClient();
    }
};


/**
 * Stops the server
 */
NAPI.prototype.stop = function stop(callback) {
    return this.server.close(callback);
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
 * Creates a workflow client and initializes the workflows, retrying as
 * necessary
 */
NAPI.prototype.createWorkflowClient = function createWorkflowClient() {
    var self = this;
    var conf = clone(this.config.wfapi);
    conf.path = __dirname + '/workflows';

    fs.readdir(conf.path, function (err, files) {
        if (err) {
            throw err;
        }

        conf.workflows = files.map(function (f) {
            return f.replace('.js', '');
        });

        self.log.info(conf, 'Creating workflow client');
        conf.log = self.log.child({ component: 'wfclient' });

        var att = 1;
        var timeout = null;
        var wfapi = new WFAPI(conf);

        function initWorkFlowRetry() {
            self.log.debug('Initializing workflows: attempt %d', att);
            wfapi.initWorkflows(function (err2) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }

                if (!err2) {
                    self.log.info('Loaded workflows');
                    self.wfapi = wfapi;
                    return;
                }

                self.log.error(err2,
                    'Error loading workflows (attempt: %d): retrying', att);
                att++;
                timeout = setTimeout(initWorkFlowRetry, 10000);
            });
        }

        initWorkFlowRetry();
    });
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
    this.moray.version({log: self.moray.log}, function (v) {
        self.morayVersion = v;
        modelInitRetry();
    });
};


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
