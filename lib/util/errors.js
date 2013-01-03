/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Error classes and helpers
 */

var assert = require('assert-plus');
var restify = require('restify');
var util = require('util');



// --- Exports



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
 * Error response for invalid parameters
 */
function invalidParam(field, message) {
  assert.string(field, 'field');

  return {
    field: field,
    code: 'Invalid',
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



module.exports = {
  duplicateParam: duplicateParam,
  invalidParam: invalidParam,
  InvalidParamsError: InvalidParamsError,
  missingParam: missingParam
};
