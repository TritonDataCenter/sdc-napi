/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Networking API.
 */

var bunyan = require('bunyan');
var napi = require('./lib/napi');
var restify = require('restify');


var log = bunyan.createLogger({
    name: 'napi',
    level: 'debug',
    serializers: restify.bunyan.serializers
});


function exitOnError(err) {
  if (err) {
    var errs = err.hasOwnProperty('ase_errors') ? err.ase_errors : [err];
    for (var e in errs) {
      log.error(errs[e]);
    }
    process.exit(1);
  }
}


var server;
try {
  server = napi.createServer({
    configFile: __dirname + '/config.json',
    log: log
  });
} catch (err) {
  exitOnError(err);
}

server.on('ready', function _afterReady() {
  server.loadInitialData(function () {
    log.info('Initial data loaded');
  });
});

server.start(function _afterStart() {
  var serverInfo = server.info();
  log.info('%s listening at %s', serverInfo.name, serverInfo.url);
});
