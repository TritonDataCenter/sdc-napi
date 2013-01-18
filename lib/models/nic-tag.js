/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * nic tag model
 */

var assert = require('assert');
var errors = require('../util/errors');
var restify = require('restify');
var util = require('util');
var UUID = require('node-uuid');



// --- Globals



var OBJ_CLASS = 'nicTag';
var BASE_DN = 'ou=nicTags';
var NAME_RE = /[a-zA-Z0-9_]/g;



// --- Helpers



/**
 * Creates a nic tag from the raw UFDS data
 */
function createFromRaw(params, callback) {
  var newTag;
  try {
    newTag = new NicTag({ name: params.nictag, uuid: params.uuid });
  } catch (err) {
    return callback(err);
  }

  return callback(null, newTag);
}


/**
 * Gets the ID (uuid or name) from the parameters, calling callback with an
 * error if neither is found
 */
function getID(params, callback) {
  var id;
  if (params.hasOwnProperty('uuid')) {
    id = 'uuid=' + params.uuid;
  } else if (params.hasOwnProperty('name')) {
    id = 'nictag=' + params.name;
  }

  if (!id) {
    return callback(restify.MissingParameterError(
      'Missing uuid or name'));
  }

  return callback(null, id);
}


/**
 * Checks if a nic tag with params.name already exists in UFDS, and calls
 * callback with an error if it does.
 */
function ensureNameUnused(app, log, params, callback) {
  return getNicTag(app, log, { name: params.name }, function (err, res) {
    if (res) {
      return callback(new errors.InvalidParamsError(
        util.format('A nic tag named "%s" already exists', params.name),
        [ errors.duplicateParam('name') ]));
    }

    return callback();
  });
}



// --- NicTag object



/**
 * NicTag model constructor
 */
function NicTag(params) {
  if (!params.name) {
    throw new errors.InvalidParamsError('Missing parameter: name',
      [errors.missingParam('name')]);
  }

  if (params.name && params.name.replace(NAME_RE, '') !== '') {
    throw new errors.InvalidParamsError('Invalid parameter: name',
      [errors.invalidParam('name',
        'Name must only contain numbers, letters and underscores')]);
  }

  this.params = params;
  if (!this.params.uuid) {
    this.params.uuid = UUID.v4();
  }
}


/**
 * Returns the relative dn
 */
NicTag.prototype.dn = function nicTagDN() {
  return util.format('nictag=%s, %s', this.params.name, BASE_DN);
};


/**
 * Returns the raw form of the nic tag suitable for storing in UFDS
 */
NicTag.prototype.raw = function nicRaw() {
  return {
    uuid: this.params.uuid,
    nictag: this.params.name
  };
};


/**
 * Returns the LDAP objectclass
 */
NicTag.prototype.objectClass = function nicObjectClass() {
  return OBJ_CLASS;
};


/**
 * Returns the serialized external-facing form of the nic tag
 */
NicTag.prototype.serialize = function nicSerialize() {
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
  try {
    var nicTag = new NicTag(params);
  } catch (err) {
    return callback(err);
  }

  return ensureNameUnused(app, log, params, function (err) {
    if (err) {
      return callback(err);
    }

    return app.ufds.add(nicTag, callback);
  });
}


/**
 * Gets a nic tag
 */
function getNicTag(app, log, params, callback) {
  log.debug(params, 'getNicTag: entry');
  // XXX: validate UUID here?

  return getID(params, function (err, id) {
    if (err) {
      return callback(err);
    }

    return app.ufds.get({
      baseDN: BASE_DN,
      objectClass: OBJ_CLASS,
      id: id,
      createFunc: createFromRaw
    }, callback);
  });
}


/**
 * Lists all nic tags
 */
function listNicTags(app, log, params, callback) {
  log.debug(params, 'listNicTags: entry');
  app.ufds.list({
    baseDN: BASE_DN,
    objectClass: OBJ_CLASS,
    createFunc: createFromRaw
  }, callback);
}


/**
 * Updates a nic tag
 */
function updateNicTag(app, log, params, callback) {
  log.debug(params, 'updateNicTag: entry');

  if (!params.name) {
    return callback(new errors.InvalidParamsError('Missing parameter: name',
      [errors.missingParam('name')]));
  }

  var newName = params.name;
  params.name = params.oldname;

  return getID(params, function (err, id) {
    if (err) {
      return callback(err);
    }

    return ensureNameUnused(app, log, params, function (err2) {
      if (err2) {
        return callback(err2);
      }

      return app.ufds.update({
        baseDN: BASE_DN,
        objectClass: OBJ_CLASS,
        id: id,
        params: {
          name: newName
        },
        createFunc: createFromRaw
      }, callback);
    });
  });
}


/**
 * Deletes a nic tag
 */
function deleteNicTag(app, log, params, callback) {
  log.debug(params, 'deleteNicTag: entry');

  return getID(params, function (err, id) {
    if (err) {
      return callback(err);
    }

    // XXX: Make sure tag is not in use first
    return app.ufds.del({
      baseDN: BASE_DN,
      id: id
    }, callback);
  });
}



module.exports = {
  create: createNicTag,
  del: deleteNicTag,
  get: getNicTag,
  list: listNicTags,
  NicTag: NicTag,
  update: updateNicTag
};
