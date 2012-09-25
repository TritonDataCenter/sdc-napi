/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Networking API.
 */

var bunyan = require('bunyan');
var napi = require('./lib/napi');
var restify = require('restify');


var log = bunyan.createLogger({
    name: 'napi',
    level: 'debug',
    serializers: {
        err: bunyan.stdSerializers.err,
        req: bunyan.stdSerializers.req,
        res: restify.bunyan.serializers.response
    }
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


napi.createServer({
  log: log,
  configFile: __dirname + '/config.json'
}, function _onCreate(err, server) {
  exitOnError(err);

  server.loadConfigData(function (err2) {
    exitOnError(err2);
    server.start();
  });
});
