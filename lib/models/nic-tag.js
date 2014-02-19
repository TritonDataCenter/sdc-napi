/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * nic tag model
 */

var assert = require('assert');
var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var restify = require('restify');
var util = require('util');
var util_common = require('../util/common');
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



// --- Helpers



/**
 * Validates a nic tag name.
 */
function validateName(app, log, name, val, callback) {
    validate.nicTagName(name, val, function (err) {
        if (err) {
            return callback(err);
        }

        getNicTag(app, log, { name: val }, function (err2, res) {
            if (res) {
                return callback(errors.duplicateParam(name));
            }

            return callback(null, val);
        });
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
    log.debug({ params: params }, 'createNicTag: entry');

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
 * Ensure the nic tags exist, given their names
 */
function nicTagsExist(app, log, single, name, tags, callback) {
    var errTags = [];

    if (typeof (tags) !== 'string' && !util.isArray(tags)) {
        return callback(errors.invalidParam(name,
            'must be an array'));
    }

    var invalid = [];
    var tagArr = util_common.arrayify(tags);

    if (single) {
        if (tagArr.length === 0) {
            return callback(errors.invalidParam(name,
                'must not be empty'));
        }

        if (tagArr.length > 1) {
            return callback(errors.invalidParam(name,
                'must only specify one nic tag'));
        }
    }

    if (tagArr.length === 0) {
        return callback(null, tagArr);
    }

    for (var n in tagArr) {
        if (typeof (tagArr[n]) !== 'string') {
            invalid.push(tagArr[n]);
        }
    }

    if (invalid.length !== 0) {
        var sErr = new errors.invalidParam(name, 'must be a string');
        sErr.invalid = invalid;
        return callback(sErr);
    }

    vasync.forEachParallel({
        inputs: tagArr,
        func: function _getNicTag(tag, cb) {
            return getNicTag(app, log, { name: tag }, function (err, res) {
                if (err || !res) {
                    errTags.push(tag);
                }

                return cb();
            });
        }

    }, function () {
        if (errTags.length !== 0) {
            var err = errors.invalidParam(name,
                util.format('nic tag%s not exist', errTags.length === 1 ?
                    ' does' : 's do'));
            if (!single) {
                err.invalid = errTags;
            }
            return callback(err);
        }

        if (single) {
            return callback(null, tagArr[0]);
        }

        return callback(null, tagArr);
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
    validateExists: nicTagsExist
};
