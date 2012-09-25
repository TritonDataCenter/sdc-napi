/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * UFDS convenience wrapper
 */

var assert = require('assert-plus');
var ufds_client = require('sdc-clients').UFDS;
var util = require('util');
var util_common = require('./util/common');
var vasync = require('vasync');



// --- UFDS methods



/*
 * UFDS model constructor
 *
 * @param log {Object}: bunyan logger instance
 * @param options {Object}:
 * - `baseDN` {String}: DN that all UFDS requests will be under (required)
 * - `bindDN` {String}: DN to bind to (required)
 * - `bindPassword` {String}: UFDS password (required)
 * - `url` {String}: UFDS URL (required)
 */
function UFDS(log, options) {
  assert.object(options, 'options');
  assert.string(options.baseDN, 'options.baseDN');
  this.log = log;
  this.baseDN = options.baseDN;
  delete options.baseDN;
  options.log = log;

  this.client = new ufds_client(options);
}


/*
 * Adds a model to UFDS
 *
 * @param model {Object}: an object representing a UFDS model
 *   that has the following required methods:
 * - `dn`: returns the DN used to get the model from UFDS
 * - `objectClass`: returns the model's object class
 * - `raw`: returns the model's raw data for storing in UFDS
 * @param callback {Function} `function (err, addedObj)`
 */
UFDS.prototype.add = function ufdsAdd(model, callback) {
  var dn = model.dn();
  if (!dn) {
    return callback(new Error('Unable to obtain DN from model'));
  }

  var self = this;
  var fullDN = util.format('%s, %s', dn, this.baseDN);
  var oc = model.objectClass();
  var raw = model.raw();
  if (!raw) {
    return callback(
      new Error(util.format('UFDS add: %s: raw data was empty', oc)));
  }
  raw.objectclass = oc;

  this.log.debug(raw, 'UFDS add: dn="%s"', fullDN);

  return this.client.add(fullDN, raw, function (err) {
    if (err) {
      self.log.error({err: err, raw: raw}, 'UFDS add: dn="%s"', fullDN);
      return callback(err);
    }

    return callback(null, model);
  });
};


/*
 * Gets a model from UFDS, using options.createFunc to instantiate it
 *
 * @param options {Object}:
 * - `baseDN` {String}: base DN to get the object from (required)
 * - `createFunc` {Function}: optional function used to instantiate a new
 *    object. Has the form: `function (ufdsParams, cb)`
 * - `id` {String}: ID string for this particular model (required)
 * - `objectClass` {String}: the object's UFDS objectclass (required)
 * @param callback {Function} `function (err, updatedObj)`
 */
UFDS.prototype.get = function ufdsGet(options, callback) {
  assert.object(options, 'options');
  assert.func(callback, 'callback');
  assert.string(options.baseDN, 'options.baseDN');
  assert.string(options.objectClass, 'options.objectClass');
  assert.string(options.id, 'options.id');
  assert.optionalFunc(options.createFunc, 'options.createFunc');

  var self = this;
  var fullDN = util.format('%s, %s', options.baseDN, this.baseDN);

  var getOpts = {
    scope: 'sub',
    filter: util.format('(&(objectclass=%s)(%s))', options.objectClass,
      options.id)
  };

  var dbg = { dn: fullDN, filter: getOpts.filter };
  self.log.debug(dbg, 'UFDS get: start');

  this.client.search(fullDN, getOpts, function (err, items) {
    self.log.debug({params: dbg, items: items}, 'UFDS get: search cb entered');

    if (err) {
      self.log.error({params: dbg, err: err}, 'UFDS get: error');
      return callback(err);
    }

    if (items.length === 0) {
      self.log.debug(dbg, 'UFDS get: no items returned');
      return callback(null, null);
    }

    // XXX: what to do if there are multiple matches?
    if (!options.hasOwnProperty('createFunc')) {
      self.log.debug({params: dbg, item: items[0]}, 'UFDS get: no createFunc');
      return callback(null, items[0]);
    }

    return options.createFunc(items[0], callback);
  });
};


/*
 * Lists a the raw data for a model from UFDS
 *
 * @param options {Object}:
 * - `baseDN` {String}: base DN to fetch the objects from (required)
 * - `createFunc` {Function}: optional function used to instantiate a new
 *    object. Has the form: `function (ufdsParams, cb)`
 * - `filter` {Object}: UFDS attributes to filter on. Each key / value pair
 *   translates to a UFDS attribute to filter on. If a value is an array or
 *   comma-separated, the values in that list are ORed.
 * - `objectClass` {String}: the object's UFDS objectclass (required)
 * @param callback {Function} `function (err, updatedObj)`
 */
UFDS.prototype.list = function ufdsList(options, callback) {
  assert.func(callback, 'callback');
  assert.object(options, 'options');
  assert.string(options.baseDN, 'options.baseDN');
  assert.optionalFunc(options.createFunc, 'options.createFunc');
  assert.optionalObject(options.filter, 'options.filter');
  assert.string(options.objectClass, 'options.objectClass');

  var self = this;
  var filter = '';
  var fullDN = util.format('%s, %s', options.baseDN, this.baseDN);

  if (options.filter && !util_common.hashEmpty(options.filter)) {
    filter = Object.keys(options.filter).reduce(function (arr, i) {
      // Comma-separated values: turn them into a list
      if (typeof (options.filter[i]) === 'string' &&
        options.filter[i].indexOf(',') !== -1) {
        /* JSSTYLED */
        options.filter[i] = options.filter[i].split(/\s*,\s*/);
      }
      if (typeof (options.filter[i]) === 'object') {
        arr.push('(|');
        for (var j in options.filter[i]) {
          arr.push(util.format('(%s=%s)', i, options.filter[i][j]));
        }
        arr.push(')');
      } else {
        arr.push(util.format('(%s=%s)', i, options.filter[i]));
      }
      return arr;
    }, []).join('');
  }

  var searchOpts = {
    scope: 'sub',
    filter: util.format('(&(objectclass=%s)%s)', options.objectClass, filter)
  };

  var dbg = {dn: fullDN, filter: searchOpts.filter};
  self.log.debug(dbg, 'UFDS list: start');

  this.client.search(fullDN, searchOpts, function (err, items) {
    self.log.debug(dbg, 'UFDS list: search cb entered');
    if (err) {
      self.log.error({params: dbg, err: err}, 'UFDS list: error');
      return callback(err);
    }

    if (!options.hasOwnProperty('createFunc')) {
      self.log.debug(dbg, 'UFDS list: no createFunc');
      return callback(null, items);
    }

    // XXX: rate-limit this!
    var results = [];
    return vasync.forEachParallel({
      inputs: items,
      func: function _listCreate(p, cb) {
          options.createFunc(p, function (e, r) {
            // XXX: give the option to error out here?
            if (e) {
              self.log.error({err: e, params: dbg, raw: p},
                'UFDS list: create callback error');
              return cb();
            }

            results.push(r);
            return cb(null);
          });
        }
      }, function (err2, res) {
        if (err2) {
          self.log.error({err: err2, params: dbg},
            'UFDS list: error creating model');
          return callback(err2);
        }

        self.log.debug(dbg, 'UFDS list: returning %d results', results.length);
        return callback(null, results);
      });
  });
};


/*
 * Updates a model in UFDS, using createFn to instantiate the updated model
 *
 * @param options {Object}:
 * - `baseDN` {String}: base DN to fetch the object from (required)
 * - `createFunc` {Function}: optional function used to instantiate a new
 *    object. Has the form: `function (ufdsParams, cb)`
 * - `id` {String}: unique identifier for this object (required)
 * - `objectClass` {String}: the object's UFDS objectclass (required)
 * - `params` {Object}: object parameters to update (required)
 * - `remove` {Bool}: if set, will remove the parameters from the object
 *    rather than updating them
 * @param callback {Function} `function (err, updatedObj)`
 */
UFDS.prototype.update = function ufdsUpdate(options, callback) {
  assert.func(callback, 'callback');
  assert.object(options, 'options');
  assert.string(options.baseDN, 'options.baseDN');
  assert.optionalFunc(options.createFunc, 'options.createFunc');
  assert.string(options.id, 'options.id');
  assert.string(options.objectClass, 'options.objectClass');
  assert.object(options.params, 'options.params');
  assert.optionalBool(options.remove, 'options.remove');

  var self = this;
  var fullDN = util.format('%s, %s, %s', options.id, options.baseDN,
    this.baseDN);

  var operation = {
    type: 'replace',
    modification: options.params
  };
  if (options.remove) {
    operation.type = 'delete';
  }

  var dbg = { type: operation.type, params: options.params, dn: fullDN };

  this.log.debug(dbg, 'UFDS update: start');

  this.client.modify(fullDN, operation, function (err) {
    if (err) {
      self.log.error({ err: err, params: dbg},
        'UFDS update: error');
      return callback(err);
    }

    return self.get(options, callback);
  });
};


/*
 * Deletes the children of a DN
 */
UFDS.prototype.delChildren = function ufdsDelChildren(DN, callback) {
  var self = this;
  self.log.info('UFDS delChildren: dn="%s"', DN);

  return this.client.search(DN, { scope: 'sub' }, function (err, items) {
    self.log.debug('UFDS delChildren: in search cb');
    if (err) {
      self.log.error(err, 'UFDS delChildren: error searching: dn="%s', DN);
      return callback(err);
    }

    // XXX: limit the number of concurrent connections
    return vasync.forEachParallel({
      inputs: items,
      func: function _delChild(item, cb) {
        if (item.dn == DN) {
          return cb(null);
        }
        var dbg = { parentDN: DN, dn: item.dn };
        self.log.info(dbg, 'UFDS delChildren: deleting child');

        return self.client.del(item.dn, function (err2) {
          if (err2) {
            self.log.error({ params: dbg, err: err2 },
              'UFDS delChildren: error deleting child');
          }

          return cb(err2);
        });
      }
    }, function (err2) {
      return callback(err2);
    });
  });
};


/*
 * Deletes a model in UFDS
 *
 * @param options {Object}:
 * - `baseDN` {String}: base DN to fetch the object from (required)
 * - `children` {Bool}: if set, will recursively delete the object's
 *                      children (optional)
 * - `id` {String}: unique identifier for this object (required)
 * @param callback {Function} `function (err)`
 */
UFDS.prototype.del = function ufdsDel(options, callback) {
  assert.object(options, 'options');
  assert.func(callback, 'callback');
  assert.string(options.baseDN, 'options.baseDN');
  assert.string(options.id, 'options.id');
  assert.optionalBool(options.children, 'options.children');

  var self = this;
  var fullDN = util.format('%s, %s, %s', options.id, options.baseDN,
    this.baseDN);

  vasync.pipeline({
    funcs: [
      function _delChildren(_, cb) {
        // Delete children if necessary
        if (!options.children) {
          return cb(null);
        }

        return self.delChildren(fullDN, cb);
      }, function _delOriginal(_, cb) {
        self.log.debug('UFDS del: dn="%s"', fullDN);
        self.client.del(fullDN, function (err) {
          self.log.debug('UFDS del: dn="%s": cb entry', fullDN);
          if (err) {
            self.log.error(err, 'UFDS del: error: dn="%s', fullDN);
          }
          return cb(err);
        });
      }
    ]
  }, function (err) {
    return callback(err);
  });
};


/*
 * Closes the connection to UFDS
 *
 * @param callback {Function} `function (err)`
 */
UFDS.prototype.close = function ufdsClose(callback) {
  var self = this;
  this.client.close(function (err) {
    if (err) {
      self.log.error(err, 'UFDS close: error closing connection');
    }

    return callback(err);
  });
};



// --- Exported functions



/*
 * Creates a new client
 *
 * @param log {Object}: bunyan logger instance
 * @param options {Object}:
 * - `baseDN` {String}: DN that all UFDS requests will be under (required)
 * - `bindDN` {String}: DN to bind to (required)
 * - `bindPassword` {String}: UFDS password (required)
 * - `url` {String}: UFDS URL (required)
 * @param callback {Function} `function (err)`
 */
function createClient(log, options, callback) {
  var ufds = new UFDS(log, options);

  var errCb = function (err) {
    return callback(err);
  };

  ufds.client.on('error', errCb);

  ufds.client.on('ready', function () {
    ufds.client.removeListener('error', errCb);
    return callback(null, ufds);
  });
}



module.exports = {
  createClient: createClient
};
