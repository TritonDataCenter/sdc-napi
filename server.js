/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Main entry-point for the Networking API.
 */

var napi = require('./lib/napi');

var restify = require('restify');
var bunyan = require('bunyan');


var log = bunyan.createLogger({
    name: 'napi',
    level: 'debug',
    serializers: {
        err: bunyan.stdSerializers.err,
        req: bunyan.stdSerializers.req,
        res: restify.bunyan.serializers.response
    }
});

var server;

try {
  server = napi.createServer({
    log: log,
    configFile: __dirname + '/config.json'
  });
} catch (err) {
  var errs = err.hasOwnProperty('ase_errors') ? err.ase_errors : [err];
  for (var e in errs) {
    log.error(errs[e]);
  }
  process.exit(1);
}

server.start();
