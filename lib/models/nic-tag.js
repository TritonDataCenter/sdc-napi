/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
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

/*
 * Circular dependencies required at end of file.
 * var mod_network = require('./network');
 */

// --- Globals



var BUCKET = {
    desc: 'nic tag',
    name: 'napi_nic_tags',
    schema: {
        index: {
            name: { type: 'string', unique: true },
            uuid: { type: 'string', unique: true },
            mtu: { type: 'number' }
        }
    }
};



// --- Helpers


/**
 * Validates a nic tag name is acceptable and unused.
 */
function validateName(app, log, name, val, callback) {
    validate.nicTagName(name, val, function (err) {
        log.debug([name, val], 'validateName: entry');

        if (err) {
            return callback(err);
        }

        getNicTag(app, log, { name: val }, function (err2, res) {
            if (err2 && err2.name !== 'ResourceNotFoundError') {
                return callback(err2);
            }

            if (res) {
                return callback(errors.duplicateParam(name));
            }

            return callback(null, val);
        });
    });
}

/**
 * Validates that the admin nic is created with an MTU of 1500.
 */
function validateNicTagCreation(params, parsed, cb) {
    if (parsed.name !== 'admin') {
        return cb();
    }

    if (parsed.hasOwnProperty('mtu') && parsed.mtu != constants.MTU_DEFAULT) {
        return cb(errors.invalidParam('mtu', constants.ADMIN_MTU_MSG));
    }
    return cb();
}

/**
 * Validation of dependencies between parameters.
 */

/**
 * Validates that a nicTag is not in use when a delete or name change
 * is requested
 */
function nicTagInUse(opts, params, parsed, cb) {
    if (parsed.hasOwnProperty('name') && parsed.name !== params.oldname) {
        var checkName;
        if (params.hasOwnProperty('oldname')) {
            checkName = params.oldname; // update case
        } else {
            checkName = parsed.name; // delete case
        }

        return mod_network.list(opts.app, opts.log, { nic_tag: checkName  },
            function (err, results) {

            if (err) {
                return cb(err);
            }

            if (results && results.length !== 0) {
                return cb(results.map(function (net) {
                    return errors.usedByParam('nic_tag', 'network', net.uuid);
                }));
            }
            return cb();
        });
    }
    return cb();
}

/**
 * Must have one of Name or MTU in an update.
 */
function nameOrMTURequired(opts, params, parsed, cb) {
    if (!(parsed.hasOwnProperty('name') || parsed.hasOwnProperty('mtu'))) {
        return cb(errors.missingParam('name'));
    }
    return cb();
}

function adminUpdateProhibited(opts, params, parsed, cb) {
    if (params.oldname === 'admin') {
        return cb(errors.invalidParam('name', constants.ADMIN_UPDATE_MSG));
    }
    return cb();
}

function externalNameChangeProhibited(opts, params, parsed, cb) {
    if (params.oldname === 'external' && parsed.name !== 'external') {
        return cb(errors.invalidParam('name', constants.EXTERNAL_RENAME_MSG));
    }
    return cb();
}

function validNameChange(opts, params, parsed, cb) {
    // 'name' is not required in requests, so normalize to the old name here.
    if (!parsed.hasOwnProperty('name')) {
        parsed.name = params.oldname;
    }

    // if changing name, can't use an existing name
    if (params.oldname !== parsed.name) {
        return getNicTag(opts.app, opts.log, { name: parsed.name },
            function (err, nictag) {
            if (nictag) {
                return cb(errors.duplicateParam('name'));
            }
            return cb();
        });
    }
    return cb();
}


/**
 * Validates that a nic_tag MTU change is compatible with the MTUs of
 * its networks.
 */
function networkMTU(opts, params, parsed, callback) {
    if (parsed.hasOwnProperty('mtu')) {

        mod_network.list(opts.app, opts.log,
            util.format('(&(nic_tag=%s)(mtu>=%d)(!(mtu<=%d)))',
            params.oldname, parsed.mtu, parsed.mtu),
            function (listErr, networks) {

            if (listErr) {
                return callback(listErr);
            }

            if (networks.length !== 0) {
                return callback(errors.nictagMtuInvalidForNetworks(networks));
            }
            return callback();
        });
    } else {
        return callback();
    }
}




// --- NicTag object


/**
 * NicTag model constructor
 */
function NicTag(params) {
    this.params = {
        name: params.name,
        uuid: params.uuid || UUID.v4(),
        mtu: params.mtu || constants.MTU_DEFAULT
    };

    this.__defineGetter__('name', function () { return this.params.name; });
}


/**
 * Returns the raw form of the nic tag suitable for storing in moray,
 * which is the same as the serialized form
 */
NicTag.prototype.raw = NicTag.prototype.serialize = function nicRaw() {
    return {
        uuid: this.params.uuid,
        name: this.params.name,
        mtu: this.params.mtu
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
            uuid: validate.UUID,
            mtu: validate.nicTagMTU
        },
        after: validateNicTagCreation
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
    var validatedParams;

    vasync.pipeline({
        funcs: [
        function _validateUpdate(_, cb) {
            validate.params({
                params: params,
                optional: {
                    name: validate.nicTagName,
                    mtu: validate.nicTagMTU
                },
                after: [
                    nicTagInUse.bind(null, { app: app, log: log }),
                    nameOrMTURequired.bind(null, { app: app, log: log}),
                    adminUpdateProhibited.bind(null, { app: app, log: log}),
                    externalNameChangeProhibited.bind(null,
                        { app: app, log: log}),
                    validNameChange.bind(null, { app: app, log: log}),
                    networkMTU.bind(null, { app: app, log: log })
                ]
            },
            function (err, parsed) {
                if (err) {
                    return cb(err);
                }
                validatedParams = parsed;
                return cb();
            });
        },

        function _getOld(_, cb) {
            // We only allow updating MTU and name (which is the bucket key)
            mod_moray.getObj(app.moray, BUCKET, params.oldname,
                function (err, rec) {
                if (err) {
                    return cb(err);
                }

                rec.value.name = validatedParams.name;
                rec.value.mtu = validatedParams.mtu;
                tag = new NicTag(rec.value);
                return cb();
            });
        },

        // XXX NAPI-214 - delete/create in a transaction
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

    validate.params({
        params: params,
        required: {
            name: validate.nicTagName
        },
        after: nicTagInUse.bind(null, { app: app, log: log })
    }, function (err) {
        if (err) {
            return callback(err);
        }

        app.moray.delObject(BUCKET.name, params.name, function (err2) {
            if (err2) {
                return callback(err2);
            }

            return callback();
        });
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

/*
 * Circular dependencies 'require'd here. DON'T ASK QUESTIONS.
 */
var mod_network = require('./network');
