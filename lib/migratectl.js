/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Bucket migration functions
 *
 * Migration of the records is performed by constructing the corresponding
 * model using the existing parameters stored in moray, then calling `raw()` to
 * get the new record to put into moray. Since migration only uses the new model
 * to construct new instances, you must be able to create new, valid records
 * from the parameters in the old records.
 *
 *
 * Migrating a bucket involves the following steps:
 * 1. Check and update bucket schema and version, if needed.
 * 2. Re-index objects.
 * 3. Re-put objects.
 *
 * Every step happens for each bucket every time NAPI starts. Since NAPI could
 * have crashed during re-indexing or re-putting, we run both each time to check
 * for any records that still need to be processed.
 */

'use strict';

var bunyan = require('bunyan');
var dashdash = require('dashdash');
var mod_ip = require('./lib/models/ip');
var mod_migrate = require('./migrate');
var mod_moray = require('./apis/moray');
var NAPI = require('sdc-clients').NAPI;
var path = require('path');
var util = require('util');


var OPTS = [
    {
        names: ['help', 'h'],
        type: 'bool',
        help: 'Print help and exit.'
    },
    {
        names: ['config', 'f'],
        type: 'string',
        help: 'Specify config file path',
        default: '../config.json'
    }
];

function usage(exit) {
    var str = 'Usage:\n' +
        'node %s <UUID>\n';

    console.log(util.format(str, path.basename(process.argv[1])));
    process.exit(exit || 0);
}



function main() {
    var parser = dashdash.createParser({ options: OPTS });
    var opts, config;
    try {
        opts = parser.parse(process.argv);
    } catch (e) {
        console.error('error: ' + e.message);
        process.exit(1);
    }

    if (opts.help) {
        usage(0);
    }

    if (opts._args.length !== 1) {
        usage(1);
    }

    try {
        config = require(opts.config);
    } catch (_) {
        console.error('error: ' + path.resolve(opts.config) +
            ' invalid or not found.');
        process.exit(1);
    }

    var log = bunyan.createLogger({
        name: 'migratectl',
        level: 'INFO',
        stream: process.stdout,
        serializers: bunyan.stdSerializers
    });

    var morayConf = {
        connectTimeout: 1000,
        host: config.moray.host,
        log: log,
        noCache: true,
        port: config.moray.port,
        reconnect: true,
        retry: {
            retries: 5,
            maxTimeout: 100,
            minTimeout: 10
        }
    };

    var client = mod_moray.createClient(morayConf);
    var host = 'localhost';
    var port = process.env.NAPI_PORT || 80;
    var napi = new NAPI({
        agent: false,
        url: util.format('http://%s:%d', host, port)
    });
    var uuid = opts._args[0];
    var bucket = mod_ip.bucket(uuid);

    client.on('connect', function () {
        var migrateOpts = {
            moray: client,
            bucket: bucket,
            log: log,
            model: mod_ip.IP,
            extra: {
                use_strings: true
            }
        };

        mod_migrate.migrate(migrateOpts, function (merr) {
            if (merr) {
                log.fatal({ error: merr }, 'error during migration');
                process.exit(1);
            }

            var updateParams = {
                params: {
                    ip_use_strings: true
                }
            };

            napi.updateNetwork(uuid, updateParams, function (uerr) {
                if (uerr) {
                    log.fatal({ error: uerr }, 'error updating network');
                    process.exit(1);
                }
                return;
            });
        });
    });
}



if (require.main === module) {
    main();
}
