/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Utilities: sharing is caring
 */

var restify = require('restify');

/*
 * Returns true if the hash is empty
 */
function hashEmpty(hash) {
  /* jsl:ignore (for unused variable warning) */
  for (var k in hash) {
    return false;
  }
  /* jsl:end */

  return true;
}


/*
 * Keeps repeating repeatCb, calling afterCb once done.
 * the arguments to repeatCb are: fn(err, res, keepGoing)
 * Every time repeatCb calls cb with keepGoing === true,
 * repeatCb will be called again on nextTick.
 */
function repeat(repeatCb, afterCb) {
  var next;

  next = function (err, res, keepGoing) {
    if (!keepGoing) {
      return afterCb(err, res);
    }

    return process.nextTick(function _repeat() { repeatCb(next); });
  };

  return process.nextTick(function _repeatFirst() { repeatCb(next); });
}


/*
 * Ensures a hash has the required parameters - returns an error if
 * it doesn't.
 * @param requiredParams {Array}: list of required params
 * @param params {Object}: hash of actual params
 */
function requireParams(requiredParams, params) {
  var missing = [];
  for (var p in requiredParams) {
    var param = requiredParams[p];
    if (!params.hasOwnProperty(param)) {
      missing.push(param);
    }
  }

  if (missing.length != 0) {
    return new restify.MissingParameterError('Missing parameter%s: %s',
        missing.length == 1 ? '': 's', missing.join(', '));
  }

  return null;
}


/*
 * Translates parameters in from -> to (modifying to), using map as a guide
 */
function translateParams(from, map, to) {
  for (var p in map) {
    if (from.hasOwnProperty(p)) {
      to[map[p]] = from[p];
    }
  }
}


/**
 * Turn a value into an array, unless it is one already.
 */
function arrayify(obj) {
  if (typeof obj === 'object') {
    return obj;
  }

  return obj.split(',');
}



module.exports = {
  arrayify: arrayify,
  hashEmpty: hashEmpty,
  repeat: repeat,
  requireParams: requireParams,
  translateParams: translateParams
};
