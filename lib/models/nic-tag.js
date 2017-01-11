/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016, Joyent, Inc.
 */

/*
 * nic tag model
 */

'use strict';

var constants = require('../util/constants');
var errors = require('../util/errors');
var mod_moray = require('../apis/moray');
var util = require('util');
var util_common = require('../util/common');
var UUID = require('node-uuid');
var validate = require('../util/validate');
var vasync = require('vasync');

/*
 * Circular dependencies required at end of file.
 */
var mod_network; // = require('./network');



// --- Globals



var BUCKET = {
    desc: 'nic tag',
    name: 'napi_nic_tags',
    schema: {
        index: {
            mtu: { type: 'number' },
            name: { type: 'string', unique: true },
            uuid: { type: 'string', unique: true },
            v: { type: 'number' }
        }
    },
    version: 1
};


// --- Schema validation objects


var CREATE_SCHEMA = {
    required: {
        name: validateName
    },
    optional: {
        uuid: validate.UUID,
        mtu: validate.nicTagMTU
    },
    after: validateNicTagCreation
};

var GET_SCHEMA = {
    required: {
        name: validate.nicTagName
    }
};

var LIST_SCHEMA = {
    strict: true,
    optional: {
        limit: validate.limit,
        offset: validate.offset
    }
};

var UPDATE_SCHEMA = {
    optional: {
        name: validate.nicTagName,
        mtu: validate.nicTagMTU
    },
    after: [
        nicTagInUse,
        nameOrMTURequired,
        adminUpdateProhibited,
        externalNameChangeProhibited,
        validNameChange,
        networkMTU
    ]
};

var DELETE_SCHEMA = {
    required: {
        name: validate.nicTagName
    },
    after: nicTagInUse
};

// --- Helpers


/**
 * Validates a nic tag name is acceptable and unused.
 */
function validateName(opts, name, val, callback) {
    validate.nicTagName(opts, name, val, function (err) {
        if (err) {
            return callback(err);
        }

        getNicTag(opts.app, opts.log, { name: val }, function (err2, res) {
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
function validateNicTagCreation(_opts, _, parsed, cb) {
    if (parsed.name !== 'admin') {
        return cb();
    }

    if (parsed.hasOwnProperty('mtu') && parsed.mtu !== constants.MTU_DEFAULT) {
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

        return mod_network.list({
            app: opts.app,
            log: opts.log,
            params: { nic_tag: checkName }
        }, function (err, results) {

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
function nameOrMTURequired(_opts, _params, parsed, cb) {
    if (!(parsed.hasOwnProperty('name') || parsed.hasOwnProperty('mtu'))) {
        return cb(errors.missingParam('name'));
    }
    return cb();
}


function adminUpdateProhibited(_opts, params, _parsed, cb) {
    if (params.oldname === 'admin') {
        return cb(errors.invalidParam('name', constants.ADMIN_UPDATE_MSG));
    }
    return cb();
}


function externalNameChangeProhibited(_opts, params, parsed, cb) {
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
            if (err && err.name !== 'ResourceNotFoundError') {
                return cb(err);
            }
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
    if (!parsed.hasOwnProperty('mtu')) {
        callback();
        return;
    }

    mod_network.list({
        app: opts.app,
        log: opts.log,
        params: {
            nic_tag: params.oldname
        }
    }, function (listErr, networks) {
        var n;

        if (listErr) {
            callback(listErr);
            return;
        }

        for (n in networks) {
            if (!networks.hasOwnProperty(n)) {
                continue;
            }
            if (networks[n].params.mtu > parsed.mtu) {
                callback(errors.nictagMtuInvalidForNetworks(networks));
                return;
            }
        }

        callback();
    });
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

    if (params.hasOwnProperty('etag')) {
        this.etag = params.etag;
    } else {
        this.etag = null;
    }

    if (params.hasOwnProperty('oldname')) {
        this.params.oldname = params.oldname;
    }
}

Object.defineProperty(NicTag.prototype, 'name', {
    get: function () { return this.params.name; }
});


/**
 * Returns an object suitable for passing to a moray batch
 */
NicTag.prototype.batch = function nicTagBatch() {
    return {
        bucket: BUCKET.name,
        key: this.name,
        operation: 'put',
        value: this.raw(),
        options: {
            etag: this.etag
        }
    };
};


/**
 * Returns a moray batch object for deleting this nic tag
 */
NicTag.prototype.delBatch = function nicTagDelBatch() {
    var batchObj = {
        bucket: BUCKET.name,
        key: this.name,
        operation: 'delete'
    };

    if (this.params.oldname) {
        batchObj.key = this.params.oldname;
    }

    return batchObj;
};


/**
 * Returns the raw form of the nic tag suitable for storing in moray
 */
NicTag.prototype.raw = function nicTagRaw() {
    return {
        mtu: this.params.mtu,
        name: this.params.name,
        uuid: this.params.uuid,
        v: BUCKET.version
    };
};


/**
 * Returns the raw form of the nic tag suitable for storing in moray
 */
NicTag.prototype.serialize = function nicTagSerialize() {
    return {
        mtu: this.params.mtu,
        name: this.params.name,
        uuid: this.params.uuid
    };
};



// --- Exported functions



/**
 * Creates a new nic tag
 */
function createNicTag(app, log, params, callback) {
    log.debug({ params: params }, 'createNicTag: entry');

    var copts = {
        app: app,
        log: log
    };

    validate.params(CREATE_SCHEMA, copts, params, function (err) {
        if (err) {
            return callback(err);
        }

        var tag = new NicTag(params);
        app.moray.putObject(BUCKET.name, tag.name, tag.raw(), { etag: null },
            function (err2) {
            if (err2) {
                callback(err2);
                return;
            }

            callback(null, tag);
        });
    });
}


/**
 * Gets a nic tag
 */
function getNicTag(app, log, params, callback) {
    log.debug(params, 'getNicTag: entry');

    validate.params(GET_SCHEMA, null, params, function (err) {
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
function listNicTags(app, log, oparams, callback) {
    log.debug({ params: oparams }, 'listNicTags: entry');

    validate.params(LIST_SCHEMA, null, oparams, function (err, params) {
        if (err) {
            return callback(err);
        }

        mod_moray.listObjs({
            filter: '(name=*)',
            limit: params.limit,
            offset: params.offset,
            log: log,
            bucket: BUCKET,
            model: NicTag,
            moray: app.moray,
            sort: {
                attribute: 'name',
                order: 'ASC'
            }
        }, callback);

    });
}


/**
 * Updates a nic tag
 */
function updateNicTag(app, log, params, callback) {
    log.debug(params, 'updateNicTag: entry');
    var tag;
    var validatedParams;

    var opts = {
        app: app,
        log: log
    };

    vasync.pipeline({
        funcs: [
        function _validateUpdate(_, cb) {
            validate.params(UPDATE_SCHEMA, opts, params,
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

                rec.value.etag = rec._etag;
                [ 'name', 'mtu' ].forEach(function (p) {
                    if (validatedParams.hasOwnProperty(p)) {
                        rec.value[p] = validatedParams[p];
                    }
                });

                if (validatedParams.name !== params.oldname) {
                    rec.value.oldname = params.oldname;
                }

                tag = new NicTag(rec.value);
                return cb();
            });
        },

        function _commitTag(_, cb) {
            var batch = [];

            // If we're updating the name, do a delete then a create
            if (validatedParams.name !== params.oldname) {
                batch.push(tag.delBatch());
                tag.etag = null;
            }

            batch.push(tag.batch());
            app.moray.batch(batch, cb);
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

    var dopts = {
        app: app,
        log: log
    };

    validate.params(DELETE_SCHEMA, dopts, params, function (err) {
        if (err) {
            callback(err);
            return;
        }

        app.moray.delObject(BUCKET.name, params.name, callback);
    });
}


/**
 * Ensure the nic tags exist, given their names
 */
function nicTagsExist(single, opts, name, tags, callback) {
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

    vasync.forEachPipeline({
        inputs: tagArr,
        func: function _getNicTag(tag, cb) {
            getNicTag(opts.app, opts.log, { name: tag }, function (err, res) {
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
    bucket: function () { return BUCKET; },
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
mod_network = require('./network');
