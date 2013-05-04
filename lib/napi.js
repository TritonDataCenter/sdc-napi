/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
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
var mod_net = require('./models/network');
var mod_nicTag = require('./models/nic-tag');
var moray = require('moray');
var restify = require('restify');
var util = require('util');
var util_common = require('./util/common');
var util_ip = require('./util/ip');
var vasync = require('vasync');
var verror = require('verror');
var WFAPI = require('wf-client');



// --- Internal helpers



/**
 * Loads a network specified in the config file into moray
 */
function loadNetwork(app, name, netData, callback) {
    app.log.debug(netData, 'loadNetwork: entry: %s', name);
    // Required values for every logical network:
    var required = ['network', 'netmask', 'startIP', 'endIP'];
    var missing = util_common.requireParams(required, netData);
    if (missing.length !== 0) {
        var reqErr = new errors.InvalidParamsError('Missing parameters',
            missing);
        app.log.error(reqErr, 'loadNetwork: %s: parameters required', name);
        return callback(reqErr);
    }

    var cidr = util_ip.netmaskToBits(netData.netmask);
    if (!cidr) {
        return callback(new Error(
            util.format('Invalid netmask for network "%s": %s',
                name, netData.netmask)));
    }

    var map = {
        endIP: 'provision_end_ip',
        gateway: 'gateway',
        resolvers: 'resolvers',
        startIP: 'provision_start_ip',
        uuid: 'uuid',
        vlan: 'vlan_id'
    };
    var netParams = {
        name: name,
        nic_tag: name,
        subnet: util.format('%s/%d', netData.network, cidr)
    };
    util_common.translateParams(netData, map, netParams);

    // If uuid is empty, fall back to generating one
    if (!netParams.uuid) {
        delete netParams.uuid;
    }

    app.log.info(netParams, 'Creating initial nic tag / network "%s"', name);

    var createTag = true;
    var createNet = true;

    return vasync.pipeline({
        funcs: [
            function _getNicTag(_, cb) {
                mod_nicTag.get(app, app.log, { name: name },
                    function (err, res) {
                    if (err && err.name !== 'ResourceNotFoundError') {
                        return cb(err);
                    }

                    if (res) {
                        createTag = false;
                    }

                    return cb();
                });
            },
            function _createNicTag(_, cb) {
                if (!createTag) {
                    app.log.info('Initial nic tag "%s" already exists', name);
                    return cb();
                }

                return mod_nicTag.create(app, app.log, { name: name },
                    function (err, res) {
                    if (err) {
                        app.log.error(err,
                            'Error creating initial nic tag "%s"', name);
                        return cb(err);
                    }

                    if (res) {
                        app.log.info(res.serialize(),
                            'Created initial nic tag "%s"', name);
                    }

                    return cb();
                });
            },
            function _getNet(_, cb) {
                return mod_net.list(app, app.log, { name: name },
                    function (err, res) {
                    if (err) {
                        app.log.info(err, 'Error listing networks (%s)', name);
                        return cb(err);
                    }

                    if (res && res.length !== 0) {
                        createNet = false;
                    }
                    return cb();
                });
            },
            function _createNet(_, cb) {
                if (!createNet) {
                    app.log.info('Initial network "%s" already exists', name);
                    return cb();
                }

                return mod_net.create(app, app.log, netParams,
                    function (err, res) {
                    if (err) {
                        app.log.error(err,
                            'Error creating initial network "%s"',
                            netParams.name);
                        return callback(err);
                    }

                    if (res) {
                        app.log.info(res.serialize(),
                            'Created initial network "%s"', netParams.name);
                    }

                    return cb();
                });
            }
        ]}, function (err) {
            return callback(err);
        });
}



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

    var maxSockets = opts.config.maxHttpSockets || 100;
    opts.log.debug('Setting maxSockets to %d', maxSockets);
    http.globalAgent.maxSockets = maxSockets;
    https.globalAgent.maxSockets = maxSockets;

    function populateReq(req, res, next) {
        req.config = opts.config;
        req.app = self;
        req.log = opts.log;
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
        name: 'SmartDC Network API',
        version: '0.0.1'
    });

    var errLog = this.log.child({component: 'err'});

    function logIfError(req, res, route) {
        var code = res.statusCode;
        if (code == 200 || code == 204 || code == 404) {
            return;
        }

        var errData = {
            req_id: req.id,
            code: code,
            body: res._body,
            params: req.params
        };
        errLog.error(errData, '%s error: %d', route, code);
    }

    server.use(restify.acceptParser(server.acceptable));
    server.use(restify.authorizationParser());
    server.use(restify.queryParser());
    server.use(restify.bodyParser());

    var auditLog = restify.auditLogger({
        log: self.log.child({component: 'audit'})
    });

    server.on('after', function _filteredAuditLog(req, res, route, err) {
        // Don't log ping requests, to avoid filling up the log
        if (route !== 'getping' && route !== 'headping') {
            auditLog(req, res, route, err);
        }
    });
    server.on('after', logIfError);

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
NAPI.prototype.loadInitialData = function loadInitialData() {
    var self = this;
    var config = this.config;

    if (!config.hasOwnProperty('initialNetworks')) {
        self.log.info('No initial networks specified in config file');
        self.initialDataLoaded = true;
        return;
    }

    var att = 1;
    var networks = Object.keys(config.initialNetworks);
    var timeout = null;
    self.log.info(networks, '%d initial networks specified in config file',
        networks.length);

    function createNetworkRetry() {
        self.log.debug('Loading initial networks from config file (attempt %d)',
                att);
        return vasync.forEachParallel({
            inputs: networks,
            func: function _createNetwork(name, cb) {
                loadNetwork(self, name, config.initialNetworks[name], cb);
            }
        }, function (err) {
            if (!err) {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }

                self.log.info('Initial networks loaded successfully');
                self.initialDataLoaded = true;
                return;
            }

            self.log.error(err,
                'Error loading initial networks (attempt: %d): retrying', att);
            att++;
            timeout = setTimeout(createNetworkRetry, 10000);
        });
    }

    createNetworkRetry();
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
    conf.log = self.log.child({ component: 'moray', level: 'trace' });
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

            if (!err) {
                self.emit('initialized');
                return;
            }

            self.log.error(err, 'Error initializing models (attempt=%d)', att);
            att++;
            timeout = setTimeout(modelInitRetry, 10000);
        });
    }

    modelInitRetry();
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
