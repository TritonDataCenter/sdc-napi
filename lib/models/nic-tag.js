/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * nic tag model
 */

var assert = require('assert');
var restify = require('restify');
var util = require('util');
var UUID = require('node-uuid');



// --- Globals

var OBJ_CLASS = 'nicTag';
var BASE_DN = 'ou=nicTags';



// --- Helpers


/*
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


/*
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



// --- NicTag object



/*
 * NicTag model constructor
 */
function NicTag(params) {
  assert.ok(params.name, 'name is required');

  this.params = params;
  if (!this.params.uuid) {
    this.params.uuid = UUID.v4();
  }
}


/*
 * Returns the relative dn
 */
NicTag.prototype.dn = function nicTagDN() {
  return util.format('nictag=%s, %s', this.params.name, BASE_DN);
};


/*
 * Returns the raw form of the nic tag suitable for storing in UFDS
 */
NicTag.prototype.raw = function nicRaw() {
  return {
    uuid: this.params.uuid,
    nictag: this.params.name
  };
};


/*
 * Returns the LDAP objectclass
 */
NicTag.prototype.objectClass = function nicObjectClass() {
  return OBJ_CLASS;
};


/*
 * Returns the serialized external-facing form of the nic tag
 */
NicTag.prototype.serialize = function nicSerialize() {
  return {
    uuid: this.params.uuid,
    name: this.params.name
  };
};



// --- Exported functions



/*
 * Creates a new nic tag
 */
function createNicTag(app, log, params, callback) {
  log.debug(params, 'createNicTag: entry');
  try {
    var nicTag = new NicTag(params);
  } catch (err) {
    return callback(err);
  }

  return app.ufds.add(nicTag, callback);
}


/*
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


/*
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


/*
 * Updates a nic tag
 */
function updateNicTag(app, log, params, callback) {
  log.debug(params, 'updateNicTag: entry');

  return getID(params, function (err, id) {
    if (err) {
      return callback(err);
    }

    delete params.name;
    // XXX: strip out unwanted params here
    return app.ufds.update({
      baseDN: BASE_DN,
      objectClass: OBJ_CLASS,
      id: id,
      params: params,
      createFunc: createFromRaw
    }, callback);
  });
}


/*
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
  update: updateNicTag
};
