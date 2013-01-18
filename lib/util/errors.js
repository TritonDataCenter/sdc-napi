/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Error classes and helpers
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');



// --- Error classes



/**
 * Base class for invalid / missing parameters
 */
function InvalidParamsError(message, errors) {
  assert.string(message, 'message');
  assert.arrayOfObject(errors, 'errors');

  restify.RestError.call(this, {
      restCode: 'InvalidParameters',
      statusCode: 422,
      message: message,
      body: {
          code: 'InvalidParameters',
          message: message,
          errors: errors
      }
  });

  this.name = 'InvalidParamsError';
}

util.inherits(InvalidParamsError, restify.RestError);


/**
 * Base class for invalid / missing parameters
 */
function InUseError(message, errors) {
  assert.string(message, 'message');
  assert.arrayOfObject(errors, 'errors');

  restify.InvalidArgumentError.call(this, {
      restCode: 'InUse',
      statusCode: 422,
      message: message,
      body: {
          code: 'InUse',
          message: message,
          errors: errors
      }
  });

  this.name = 'InUseError';
}

util.inherits(InUseError, restify.InvalidArgumentError);



// --- Functions for building elements in a response's errors array



/**
 * Error response for invalid parameters
 */
function invalidParam(field, message) {
  assert.string(field, 'field');

  return {
    field: field,
    code: 'InvalidParameter',
    message: message || 'Invalid parameter'
  };
}


/**
 * Error response for missing parameters
 */
function missingParam(field, message) {
  assert.string(field, 'field');

  return {
    field: field,
    code: 'MissingParameter',
    message: message || 'Missing parameter'
  };
}


/*
 * Error response for duplicate parameters
 */
function duplicateParam(field, message) {
  assert.string(field, 'field');

  return {
    field: field,
    code: 'Duplicate',
    message: message || 'Already exists'
  };
}


/**
 * Error response for invalid parameters
 */
function usedBy(type, id, message) {
  assert.string(type, 'type');
  assert.string(id, 'id');

  return {
    type: type,
    id: id,
    code: 'UsedBy',
    message: message || util.format('In use by %s "%s"', type, id)
  };
}



module.exports = {
  duplicateParam: duplicateParam,
  usedBy: usedBy,
  invalidParam: invalidParam,
  InvalidParamsError: InvalidParamsError,
  InUseError: InUseError,
  missingParam: missingParam
};
