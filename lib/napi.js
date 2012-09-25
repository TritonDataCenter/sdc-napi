/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * The Networking API application
 */

var assert = require('assert-plus');
var endpoints = require('./endpoints');
var mod_config = require('./config');
var mod_net = require('./models/network');
var mod_nicTag = require('./models/nic-tag');
var restify = require('restify');
var util = require('util');
var util_common = require('./util/common');
var util_ip = require('./util/ip');
var UFDS = require('./ufds');
var vasync = require('vasync');



// --- Internal helpers



/*
 * Loads a network specified in the config file into UFDS
 */
function loadNetwork(app, name, netData, callback) {
  app.log.debug(netData, 'loadNetwork: entry: %s', name);
  // Required values for every logical network:
  var required = ['network', 'netmask', 'startIP', 'endIP'];
  var reqErr = util_common.requireParams(required, netData);
  if (reqErr) {
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
    vlan: 'vlan'
  };
  var netParams = {
    name: name,
    nic_tag: name,
    subnet: util.format('%s/%d', netData.network, cidr)
  };
  util_common.translateParams(netData, map, netParams);
  app.log.info(netParams, 'Creating initial nic tag / network "%s"', name);

  var createTag = true;
  var createNet = true;

  return vasync.pipeline({
    funcs: [
      function _getNicTag(_, cb) {
        mod_nicTag.get(app, app.log, { name: name }, function (err, res) {
          if (err) {
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
            app.log.error(err, 'Error creating initial nic tag "%s"', name);
            return cb(err);
          }

          if (res) {
            app.log.info(res.serialize(), 'Created initial nic tag "%s"', name);
          }

          return cb();
        });
      },
      function _getNet(_, cb) {
        return mod_net.list(app, app.log, { name: name }, function (err, res) {
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

        return mod_net.create(app, app.log, netParams, function (err, res) {
          if (err) {
            app.log.error(err, 'Error creating initial network "%s"',
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



/*
 * NAPI constructor
 */
function NAPI(opts) {
  var self = this;
  this.log = opts.log;
  this.config = opts.config;

  var populateReq = function (req, res, next) {
    req.config = opts.config;
    req.app = self;
    req.log = opts.log;
    return next();
  };

  var before = [ populateReq ];
  var server = this.server = restify.createServer({
    name: 'SmartDC Network API',
    version: '0.0.1'
  });

  var errLog = this.log.child({component: 'err'});
  var logErrAfter = function logIfError(req, res, route) {
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
    errLog.error(errData, '%s error: %d', route.name, code);
  };

  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.bodyParser());
  server.use(restify.queryParser());
  server.on('after', restify.auditLogger({
        log: this.log.child({component: 'audit'}),
        body: true
      }));
  server.on('after', logErrAfter);

  endpoints.registerEndpoints(server, this.log, before);
}


/*
 * Starts the server
 */
NAPI.prototype.start = function start() {
  var self = this;
  this.server.listen(self.config.port, function () {
    self.log.info('%s listening at %s', self.server.name, self.server.url);
  });
};



// --- Setup and validation



/*
 * Validates the options passed to createServer, and the config file
 */
function validate(opts) {
  assert.object(opts, 'opts');
  assert.object(opts.log, 'opts.log');
  assert.string(opts.configFile, 'opts.configFile');

  var log = opts.log;
  log.info('Loading config from "%s"', opts.configFile);
  return mod_config.load(opts.configFile);
}


/*
 * Populates initial network data from the config file
 */
NAPI.prototype.loadConfigData = function loadConfigData(callback) {
  var self = this;
  var config = this.config;

  if (!config.hasOwnProperty('initialNetworks')) {
    self.log.info('No initial networks specified in config file');
    return callback();
  }

  var networks = Object.keys(config.initialNetworks);
  self.log.info(networks, 'Loading initial networks from config file');

  return vasync.forEachParallel({
    inputs: networks,
    func: function _createNetwork(name, cb) {
      loadNetwork(self, name, config.initialNetworks[name], cb);
    }
  }, function (err, results) {
    if (err) {
      return callback(err);
    }

    self.log.info('Initial networks loaded successfully');
    return callback(null);
  });
};


/*
 * Creates a new NAPI server
 */
function createServer(opts, callback) {
  try {
    var config = validate(opts);
  } catch (err) {
    return callback(err);
  }

  if (config.hasOwnProperty('logLevel')) {
    opts.log.info('Setting log level to "%s"', config.logLevel);
    opts.log.level(config.logLevel);
  }

  var napi = new NAPI({
    log: opts.log,
    config: config
  });

  return UFDS.createClient(opts.log, config.ufds, function (err, client) {
    if (err) {
      return callback(err);
    }

    napi.ufds = client;
    return callback(null, napi);
  });
}



// --- Exports

module.exports = {
  createServer: createServer
};
