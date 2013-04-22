/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * nic tag model
 */

var assert = require('assert');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var restify = require('restify');
var util = require('util');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');
var verror = require('verror');



// --- Globals



var BUCKET = {
    desc: 'nic tag',
    name: 'napi_nic_tags',
    schema: {
        index: {
            name: { type: 'string', unique: true },
            uuid: { type: 'string', unique: true }
        }
    }
};
var NAME_RE = /[a-zA-Z0-9_]/g;



// --- Helpers



/**
 * Validates a nic tag name.
 */
function validateName(app, log, name, val, callback) {
    if (val && val.replace(NAME_RE, '') !== '') {
        return callback(errors.invalidParam(name,
            util.format('%s must only contain numbers, letters and underscores',
            name)));
    }

    getNicTag(app, log, { name: val }, function (err, res) {
        if (res) {
            return callback(errors.duplicateParam(name));
        }

        return callback(null, val);
    });
}



// --- NicTag object



/**
 * NicTag model constructor
 */
function NicTag(params) {
    this.params = params;

    if (!this.params.uuid) {
        this.params.uuid = UUID.v4();
    }

    this.__defineGetter__('name', function () { return this.params.name; });
}


/**
 * Returns the raw form of the nic tag suitable for storing in moray,
 * which is the same as the serialized form
 */
NicTag.prototype.raw = NicTag.prototype.serialize = function nicRaw() {
    return {
        uuid: this.params.uuid,
        name: this.params.name
    };
};



// --- Exported functions



/**
 * Creates a new nic tag
 */
function createNicTag(app, log, params, callback) {
    log.debug(params, 'createNicTag: entry');

    validate.params({
        params: params,
        required: {
            name: function (name, val, cb) {
                validateName(app, log, name, val, cb);
            }
        },
        optional: {
            uuid: validate.UUID
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        var tag = new NicTag(params);
        app.moray.putObject(BUCKET.name, tag.name, tag.raw(),
            function (err2) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, tag);
        });
    });
}


/**
 * Gets a nic tag
 */
function getNicTag(app, log, params, callback) {
    log.debug(params, 'getNicTag: entry');

    validate.params({
        params: params,
        required: {
            name: validate.string
        }
    }, function (err) {
        if (err) {
            return callback(err);
        }

        mod_moray.getObj(app.moray, BUCKET, params.name,
            function (err2, rec) {
            if (err2) {
                return callback(err2);
            }

            return callback(null, new NicTag(rec.value));
        });
    });
}


/**
 * Lists all nic tags
 */
function listNicTags(app, log, params, callback) {
    log.debug(params, 'listNicTags: entry');

    mod_moray.listObjs({
        filter: '(name=*)',
        log: log,
        bucket: BUCKET,
        model: NicTag,
        moray: app.moray,
        sort: {
            attribute: 'name',
            order: 'ASC'
        }
    }, callback);
}


/**
 * Updates a nic tag
 */
function updateNicTag(app, log, params, callback) {
    log.debug(params, 'updateNicTag: entry');
    var tag;

    vasync.pipeline({
        funcs: [
        function _validateUpdate(_, cb) {
            validate.params({
                params: params,
                required: {
                    name: function (name, val, cb2) {
                        validateName(app, log, name, val, cb2);
                    }
                }
            }, cb);
        },

        function _getOld(_, cb) {
            // We only allow updating name, which is the bucket key
            mod_moray.getObj(app.moray, BUCKET, params.oldname,
                function (err, rec) {
                if (err) {
                    return cb(err);
                }

                rec.value.name = params.name;
                tag = new NicTag(rec.value);
                return cb();
            });
        },

        function _delOld(_, cb) {
            // We only allow updating name, which is the bucket key
            app.moray.delObject(BUCKET.name, params.oldname, cb);
        },

        function _createNew(_, cb) {
            app.moray.putObject(BUCKET.name, params.name, tag.raw(), cb);
        }
        ]
    }, function (err) {
        if (err) {
            return callback(err);
        }

        return callback(null, tag);
    });
}


/**
 * Deletes a nic tag
 */
function deleteNicTag(app, log, params, callback) {
    log.debug(params, 'deleteNicTag: entry');

    mod_moray.delObj(app.moray, BUCKET, params.name, function (err) {
        if (err) {
            return callback(err);
        }

        return callback();
    });
}


/**
 * Ensure the nic tag with the given name exists
 */
function nicTagExists(app, log, name, tag, callback) {
    getNicTag(app, log, { name: tag }, function (err, res) {
        if (err || !res) {
            return callback(errors.invalidParam(name,
                'nic tag does not exist'));
        }

        return callback(null, tag);
    });
}


/**
 * Initializes the nic tags bucket
 */
function initNicTagsBucket(app, callback) {
    mod_moray.initBucket(app.moray, BUCKET, callback);
}


module.exports = {
    create: createNicTag,
    del: deleteNicTag,
    get: getNicTag,
    init: initNicTagsBucket,
    list: listNicTags,
    NicTag: NicTag,
    update: updateNicTag,
    validateExists: nicTagExists
};
