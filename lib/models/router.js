/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2018, Joyent, Inc.
 */

/*
 * router object model
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../util/constants');
var errors = require('../util/errors');
var jsprim = require('jsprim');
var mod_moray = require('../apis/moray');
var mod_net = require('./network');
// var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');



// --- Globals


var BUCKET = {
    desc: 'router object',
    name: 'napi_router_objects',
    schema: {
        index: {
            // Router Object's name
            name: { type: 'string' },
            // Array of network UUIDs.
            networks: { type: '[string]' },
            // IPv4 or IPv6
            family: { type: 'string' },
            // Router Object's UUID
            uuid: { type: 'string', unique: true },
            // Router Object's *owner* UUID.
            // XXX KEBE ASKS, unique for owner_uuid?
            owner_uuid: { type: 'string', unique: true},

            // Additional descriptive text (XXX KEBE SAYS update RFD 120...)
            description: { type: 'string' }
        }
    },
    morayVersion: 2,        // moray version must be > than this
    version: 1
};
var MAX_NETS = 32; // No more than 32 networks per router object (for now).


// --- Schema validation objects

var CREATE_SCHEMA = {
    required: {
        name: validate.string,
        networks: validateNetworks,
        owner_uuid: validate.UUID
    },
    optional: {
        description: validate.string
        // XXX KEBE ASKS, you sure?
        // uuid: validate.UUID,
    }
    // XXX KEBE ASKS:  after?
};

var GET_SCHEMA = {
    required: {
        uuid: validate.UUID
    },
    optional: {
        // XXX KEBE ASKS, get by owner_uuid? If so, update RFD 120...
    }
};

var LIST_SCHEMA = {
    strict: true,
    optional: {
        uuid: validate.uuidPrefix,
        limit: validate.limit,
        offset: validate.offset,
        name: validate.string,
        family: validate.enum([ 'ipv4', 'ipv6' ]),
        networks: validate.stringOrArray
    },
    after: function (_opts, _, parsed, cb) {
        /*
         * For now we only allow a single network UUID; in the future, once we
         * decide how we want searching on multiple UUIDs to work by default
         * (AND or OR), this restriction can be lifted.
         */
        var networks = parsed.networks;
        if (networks && Array.isArray(networks) && networks.length > 1) {
            cb(new errors.invalidParam('networks',
                'Only one network UUID allowed'));
            return;
        }

        cb();
    }
};

// XXX KEBE ASKS, Change ModifyRouterNetworks to UpdateRouterNetworks in
// RFD 120?
var UPDATE_SCHEMA = {
    required: {
        // XXX KEBE ASKS FILL ME MORE IN?
        uuid: validate.UUID
    },
    optional: {
        name: validate.string,
        description: validate.string,
        // XXX KEBE ASKS, how?
        networks: validateNetworks
    }
    // XXX KEBE ASKS:  after?
};

var DELETE_SCHEMA = {
    required: {
        uuid: validate.UUID
    }
    // XXX KEBE ASKS, after?
};

// --- Helpers



/**
 * Returns true if the network pool with these params is provisionable by
 * the owner specified by uuid
 */
/* BEGIN JSSTYLED */
/*
function provisionableBy(params, uuid) {
    if (!params.hasOwnProperty('owner_uuids')) {
        return true;
    }

    mod_moray.valToArray(params, 'owner_uuids');
    return (params.owner_uuids.concat(
        constants.UFDS_ADMIN_UUID).indexOf(uuid) !== -1);
}
*/
/* END JSSTYLED */

/**
 * Fetch the Network objects for each of the given UUIDs.
 * XXX KEBE SAYS UNCOMMENT ME...
 */
/* BEGIN JSSTYLED */
/*
function getAllNetworks(app, log, uuids, callback) {
    vasync.forEachParallel({
        inputs: uuids,
        func: function (uuid, cb) {
            mod_net.get({
                app: app,
                log: log,
                params: { uuid: uuid }
            }, cb);
        }
    }, function getResults(err, results) {
        if (err) {
            callback(err);
            return;
        }

        function getResult(entry) {
            return entry.result;
        }

        var networks = results.operations.map(getResult);

        callback(null, networks);
    });
}
*/
/* END JSSTYLED */

/**
 * Validate that the attached networks are not over the maximum limit, and
 * that they all exist.
 */
function validateNetworks(opts, name, value, callback) {
    validate.UUIDarray(opts, name, value, function (err, uuids) {
        if (err) {
            callback(err);
            return;
        }

        _validateNetworks(opts, name, uuids, callback);
    });
}


function _validateNetworks(opts, name, uuids, callback) {
    var nets = [];
    var notFound = [];
    // var router_family;
    var routerTypeNotMatching = [];
    var validated = [];

    assert.ok(opts.app, 'opts.app');
    assert.ok(opts.log, 'opts.log');

    /*
     * Initialize the router type to the current family to
     * prevent changing the family of a router.
     */
    // if (opts.hasOwnProperty('oldRouter')) {
    //     router_family = opts.oldRouter.family;
    // }

    if (uuids.length <= 1) {
        callback(errors.invalidParam(name,
            constants.ROUTER_MIN_NETS_MSG));
        return;
    }

    if (uuids.length > MAX_NETS) {
        callback(errors.invalidParam(name,
            util.format('maximum %d networks per router object', MAX_NETS)));
        return;
    }

    vasync.forEachParallel({
        inputs: uuids,
        func: function _validateNetworkUUID(uuid, cb) {
            mod_net.get({
                app: opts.app,
                log: opts.log,
                params: { uuid: uuid }
            }, function (err) {  // XXX KEBE SAYS, 2nd param "net"?
                if (err) {
                    if (err.name === 'ResourceNotFoundError') {
                        notFound.push(uuid);
                        cb();
                    } else {
                        cb(err);
                    }
                    return;
                }

                // XXX KEBE SAYS CHECK STUFF HERE,
                // filling in routerTypeNotMatching...

            });
        }
    }, function (err) {
        if (err) {
            callback(err);
            return;
        }

        if (notFound.length !== 0) {
            err = errors.invalidParam(name,
                util.format('unknown network%s',
                    notFound.length === 1 ? '' : 's'));
            err.invalid = notFound;
            callback(err);
            return;
        }

        if (routerTypeNotMatching.length !== 0) {
            callback(errors.invalidParam(name,
                constants.ROUTER_AF_MATCH_MSG));
            return;
        }

        var toReturn = { _netobjs: nets };
        toReturn[name] = validated;

        callback(null, null, toReturn);
    });
}


/**
 * Validate that a router object's owner_uuid, such that all attached networks
 * either match that owner_uuid or have no owner_uuid.
 * XXX KEBE SAYS UNCOMMENT ME...
 */
/* BEGIN JSSTYLED */
/*
function validateNetworkOwners(_opts, _, parsed, callback) {
    if (!parsed.owner_uuid || !parsed._netobjs ||
        parsed._netobjs.length === 0) {
        callback();
        return;
    }

    var owner = parse.owner_uuid;

    var notMatching = [];
    parsed._netobjs.forEach(function (net) {
        if (net.params.hasOwnProperty('owner_uuids')) {
            for (var o in net.params.owner_uuids) {
                if (owners.hasOwnProperty(net.params.owner_uuids[o])) {
                    return;
                }
            }

            notMatching.push(net.uuid);
        }
    });

    if (notMatching.length !== 0) {
        var err = errors.invalidParam('networks',
            constants.ROUTER_OWNER_MATCH_MSG);
        err.invalid = notMatching;
        callback(err);
        return;
    }

    callback();
}
*/
/* END JSSTYLED */


// --- Router object  XXX KEBE SAYS START HERE.



/**
 * Router object model constructor
 */
function Router(params) {
    assert.object(params, 'params');

    this.params = params;

    if (!this.params.uuid) {
        this.params.uuid = UUID.v4();
    }

    if (this.params.hasOwnProperty('networks')) {
        this.params.networks = util_common.arrayify(this.params.networks);
    }
    // XXX KEBE SAYS FILL ME IN.

    Object.seal(this);
}

Object.defineProperty(Router.prototype, 'networks', {
    // Use _netobjs like network pools?
    // get: function () { return this.params._netobjs; }
    // Or not?
    get: function () { return this.params.networks; }
});

Object.defineProperty(Router.prototype, 'family', {
    get: function () {
        if (this.params.family !== undefined) {
            return this.params.family;
        }

        // XXX KEBE ASKS, ipv4 by default for now... but what if we want v6?
        return 'ipv4';
    }
});

Object.defineProperty(Router.prototype, 'uuid', {
    get: function () { return this.params.uuid; }
});


/**
 * Returns the raw moray form of the router object
 */
Router.prototype.raw = function routerRaw() {
    var raw = {
        v: BUCKET.version,
        family: this.family,
        uuid: this.params.uuid,
        name: this.params.name,
        description: this.params.description,
        networks: this.params.networks.sort(),
        owner_uuid: this.params.owner_uuid
    };

    // XXX KEBE SAYS maybe more that's processing to be done here?

    return raw;
};


/**
 * Returns the raw Moray form of this router object for adding to a batch.
 */
Router.prototype.batch = function routerBatch() {
    return {
        bucket: BUCKET.name,
        key: this.uuid,
        operation: 'put',
        value: this.raw()
        // options: {
        //    etag: this.etag
        // }
    };
};


/**
 * Returns the serialized (API-facing) form of the router object
 */
Router.prototype.serialize = function routerSerialize() {
    var ser = {
        family: this.family,
        uuid: this.params.uuid,
        name: this.params.name,
        description: this.params.description,
        networks: this.params.networks.sort(),
        owner_uuid: this.params.owner_uuid
    };

    // XXX KEBE SAYS maybe more that's processing to be done here?

    return ser;
};



// --- Exported functions



/**
 * Creates a new router object
 */
function createRouter(app, log, params, callback) {
    log.debug(params, 'createRouter: entry');

    validate.params(CREATE_SCHEMA, { app: app, log: log }, params,
        function (err, validatedParams) {
        if (err) {
            callback(err);
            return;
        }

        var router = new Router(validatedParams);
        app.moray.putObject(BUCKET.name, router.uuid, router.raw(),
            { etag: null }, function (err2) {
            if (err2) {
                callback(err2);
                return;
            }

            callback(null, router);
        });
    });
}


/**
 * Gets a router object
 */
function getRouter(app, log, params, callback) {
    log.debug(params, 'getRouter: entry');

    validate.params(GET_SCHEMA, null, params, function (err, validated) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(app.moray, BUCKET, validated.uuid,
            function (err2, rec) {
            if (err2) {
                callback(err2);
                return;
            }

            rec.value.etag = rec._etag;

            // XXX KEBE SAYS FILL ME IN

            // callback(null, router);
        });
    });
}


/**
 * Lists router objects.
 */
function listRouters(app, log, oparams, callback) {
    log.debug({ params: oparams }, 'listRouters: entry');

    validate.params(LIST_SCHEMA, null, oparams, function (valErr, params) {
        if (valErr) {
            callback(valErr);
            return;
        }

        var filterObj = {};

        if (params.uuid) {
            filterObj.uuid = params.uuid;
        }

        if (params.family) {
            filterObj.family = params.family;
        }

        if (params.name) {
            filterObj.name = params.name;
        }

        if (params.networks) {
            filterObj.networks = params.networks;
        }

        var filter = jsprim.isEmpty(filterObj) ?
            '(uuid=*)' : mod_moray.filter(filterObj);

        var req = app.moray.findObjects(BUCKET.name, filter, {
            limit: params.limit,
            offset: params.offset,
            sort: {
                attribute: 'uuid',
                order: 'ASC'
            }
        });

        var values = [];

        req.on('error', function _onListErr(err) {
            return callback(err);
        });

        req.on('record', function _onListRec(rec) {
            log.debug(rec, 'record from moray');
            values.push(rec.value);
        });

        req.on('end', function _endList() {
            vasync.forEachParallel({
                inputs: values,
                // XXX KEBE SAYS FILL ME IN...
                func: function _getRouter(val, cb) {
                    cb(val);
                }
            }, function (err) {
                if (err) {
                    callback(err);
                    return;
                }

                var routers = values.map(function (n) {
                    return new Router(n);
                });

                callback(null, routers);
            });
        });
    });
}


/**
 * Updates a Router Object
 */
function updateRouter(app, log, params, callback) {
    log.debug(params, 'updateRouter: entry');

    getRouter(app, log, params, function (getErr, oldRouter) {
        if (getErr) {
            callback(getErr);
            return;
        }

        var uopts = {
            app: app,
            log: log,
            oldRouter: oldRouter
        };

        validate.params(UPDATE_SCHEMA, uopts, params,
            function (err) { // , validatedParams) {
            if (err) {
                callback(err);
                return;
            }

            var updatedParams = oldRouter.raw();
            // XXX KEBE SAYS do update logic now.  Including checking vs.
            // existing object entries.

            // XXX KEBE SAYS make sure Router() gets built.
            var newRouter = new Router(updatedParams);

            app.moray.putObject(BUCKET.name, params.uuid, newRouter.raw(), {
                etag: oldRouter.etag
            }, function (err2) {
                if (err2) {
                    callback(err2);
                    return;
                }

                callback(null, newRouter);
            });
        });
    });
}


/**
 * Deletes a Router object
 */
function deleteRouter(app, log, params, callback) {
    log.debug(params, 'deleteRouter: entry');

    validate.params(DELETE_SCHEMA, null, params, function (err) {
        if (err) {
            return callback(err);
        }

        // XXX KEBE SAYS Obtain list of networks from this object and
        // for each network, update network-object by removing routes
        // for other networks in object. Eeesh, that's O(n^2).
        // FILL ME IN...

        app.moray.delObject(BUCKET.name, params.uuid, callback);
    });
}


/**
 * Initializes the router objects bucket
 */
function initRouters(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
    bucket: function () { return BUCKET; },
    create: createRouter,
    del: deleteRouter,
    get: getRouter,
    init: initRouters,
    list: listRouters,
    Router: Router,
    update: updateRouter
};
