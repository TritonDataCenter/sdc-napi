/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Unit tests for IP endpoints
 */

var assert = require('assert-plus');
var clone = require('clone');
var helpers = require('./helpers');
var IP = require('../../lib/models/ip').IP;
var mod_uuid = require('node-uuid');
var Network = require('../../lib/models/network').Network;
var NicTag = require('../../lib/models/nic-tag').NicTag;
var restify = require('restify');
var util = require('util');
var vasync = require('vasync');



// --- Globals



var NAPI;
var NET;
var INVALID_PARAMS = [
  ['belongs_to_uuid', 'a', 'invalid UUID'],
  ['belongs_to_type', '', 'must not be empty'],
  ['belongs_to_type', '  ', 'must not be empty'],
  ['owner_uuid', 'a', 'invalid UUID'],
  ['reserved', 'a', 'must be a boolean value'],
  ['reserved', '1', 'must be a boolean value']
];
var MULTIPLE_PARAMS_REQ = [
  { belongs_to_uuid: mod_uuid.v4() },
  { belongs_to_type: 'server' },
  { belongs_to_uuid: mod_uuid.v4(), owner_uuid: mod_uuid.v4() },
  { belongs_to_type: 'zone', owner_uuid: mod_uuid.v4() }
];




// --- Internal helpers



// --- Setup



/**
 * Sets up UFDS to return a nic tag so that the existance check in
 * network creation passes
 */
exports.setUp = function (callback) {
  NET = new Network(helpers.validNetworkParams());
  helpers.ufdsReturnValues({
    get: [
      [null, NET]
    ]
  });

  return callback();
};


exports['Create client and server'] = function (t) {
  helpers.createClientAndServer(function (err, res) {
    t.ifError(err, 'server creation');
    t.ok(res, 'client');
    NAPI = res;

    t.done();
  });
};



// --- Get tests



exports['Get IP - non-existent network'] = function (t) {
  // Set UFDS to return nothing
  var getErr = new restify.ResourceNotFoundError('network not found');
  helpers.ufdsReturnValues({
    get: [[getErr, null]]
  });

  NAPI.getIP('doesnotexist', '1.2.3.4', function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 404, 'status code');
    t.deepEqual(err.body, {
      code: getErr.restCode,
      message: getErr.message
    }, 'Error body');

    return t.done();
  });
};


exports['Get IP - outside subnet'] = function (t) {
  var invalid = [
    '10.0.3.1',
    '10.0.1.255',
    '8.8.8.8'
  ];

  var ufdsReturn = { get: [] };
  for (var i = 0; i < invalid.length; i++) {
    ufdsReturn.get.push([null, NET]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: invalid,
    func: function (ip, cb) {
      NAPI.getIP(NET.uuid, ip, function (err, res) {
        t.ok(err, 'error returned: ' + ip);
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
          code: 'ResourceNotFound',
          message: 'IP is not in subnet'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Get IP - invalid'] = function (t) {
  var invalid = [
    'a',
    '32',
    '10.0.2.256'
  ];

  var ufdsReturn = { get: [] };
  for (var i = 0; i < invalid.length; i++) {
    ufdsReturn.get.push([null, NET]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: invalid,
    func: function (ip, cb) {
      NAPI.getIP(NET.uuid, ip, function (err, res) {
        t.ok(err, 'error returned: ' + ip);
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
          code: 'ResourceNotFound',
          message: 'Invalid IP address'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};



// --- Update tests



exports['Update IP - non-existent network'] = function (t) {
  // Set UFDS to return nothing
  var getErr = new restify.ResourceNotFoundError('network not found');
  helpers.ufdsReturnValues({
    get: [[getErr, null]]
  });

  NAPI.updateIP('doesnotexist', '1.2.3.4', { reserved: true },
    function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 404, 'status code');
    t.deepEqual(err.body, {
      code: getErr.restCode,
      message: getErr.message
    }, 'Error body');

    return t.done();
  });
};


exports['Update IP - non-existent network'] = function (t) {
  // Set UFDS to return nothing
  var getErr = new restify.ResourceNotFoundError('network not found');
  helpers.ufdsReturnValues({
    get: [[getErr, null]]
  });

  NAPI.updateIP('doesnotexist', '1.2.3.4', { reserved: true },
    function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 404, 'status code');
    t.deepEqual(err.body, {
      code: getErr.restCode,
      message: getErr.message
    }, 'Error body');

    return t.done();
  });
};


exports['Update IP - outside subnet'] = function (t) {
  var invalid = [
    '10.0.3.1',
    '10.0.1.255',
    '8.8.8.8'
  ];

  var ufdsReturn = { get: [] };
  for (var i = 0; i < invalid.length; i++) {
    ufdsReturn.get.push([null, NET]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: invalid,
    func: function (ip, cb) {
      NAPI.updateIP(NET.uuid, ip, { reserved: true }, function (err, res) {
        t.ok(err, 'error returned: ' + ip);
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
          code: 'ResourceNotFound',
          message: 'IP is not in subnet'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - invalid'] = function (t) {
  var invalid = [
    'a',
    '32',
    '10.0.2.256'
  ];

  var ufdsReturn = { get: [] };
  for (var i = 0; i < invalid.length; i++) {
    ufdsReturn.get.push([null, NET]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: invalid,
    func: function (ip, cb) {
      NAPI.updateIP(NET.uuid, ip, { reserved: true }, function (err, res) {
        t.ok(err, 'error returned: ' + ip);
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 404, 'status code');
        t.deepEqual(err.body, {
          code: 'ResourceNotFound',
          message: 'Invalid IP address'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - invalid params (IP not in UFDS)'] = function (t) {
  var ufdsReturn = { get: [] };
  for (var i = 0; i < INVALID_PARAMS.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([new restify.ResourceNotFoundError(
      'IP\'s not here, man'), null]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  // XXX: also do this for an update
  vasync.forEachParallel({
    inputs: INVALID_PARAMS,
    func: function (data, cb) {
      var params = helpers.validIPparams();
      params[data[0]] = data[1];
      NAPI.updateIP(NET.uuid, '10.0.2.4', params, function (err, res) {
        t.ok(err, util.format('error returned: %s="%s"', data[0], data[1]));
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
          code: 'InvalidParameters',
          message: 'Invalid parameters',
          errors: [
            helpers.invalidParam(data[0], data[2])
          ]
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - invalid params (IP in UFDS)'] = function (t) {
  var ip = new IP({ ip: '10.0.2.4', network_uuid: NET.uuid, reserved: true});
  var ufdsReturn = { get: [] };
  for (var i = 0; i < INVALID_PARAMS.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([null, ip]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  // XXX: also do this for an update
  vasync.forEachParallel({
    inputs: INVALID_PARAMS,
    func: function (data, cb) {
      var params = helpers.validIPparams();
      params[data[0]] = data[1];
      NAPI.updateIP(NET.uuid, '10.0.2.4', params, function (err, res) {
        t.ok(err, util.format('error returned: %s="%s"', data[0], data[1]));
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
          code: 'InvalidParameters',
          message: 'Invalid parameters',
          errors: [
            helpers.invalidParam(data[0], data[2])
          ]
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


/*
 * If setting belongs_to_uuid or belongs_to_type, the other needs to be set
 * for the IP as well (either it should be already set in UFDS, or updated in
 * the same payload).  If either is set, owner_uuid needs to be set as well.
 */
exports['Update IP - invalid param combinations (IP not in UFDS)'] =
  function (t) {
  var ufdsReturn = { get: [] };
  for (var i = 0; i < MULTIPLE_PARAMS_REQ.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([new restify.ResourceNotFoundError(
      'IP\'s not here, man'), null]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: MULTIPLE_PARAMS_REQ,
    func: function (params, cb) {
      NAPI.updateIP(NET.uuid, '10.0.2.4', params, function (err, res) {
        t.ok(err, 'error returned: ' + JSON.stringify(params));
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
          code: 'InvalidParameters',
          errors: ['belongs_to_uuid', 'belongs_to_type', 'owner_uuid'].filter(
            function (p) { return !params.hasOwnProperty(p); }).map(
            function (p) { return helpers.missingParam(p, 'Missing parameter');
          }).sort(helpers.fieldSort),
          message: 'Missing parameters'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - invalid param combinations (IP in UFDS)'] =
  function (t) {
  var ip = new IP({ ip: '10.0.2.4', network_uuid: NET.uuid, reserved: true});
  var ufdsReturn = { get: [] };
  for (var i = 0; i < MULTIPLE_PARAMS_REQ.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([null, ip]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  vasync.forEachParallel({
    inputs: MULTIPLE_PARAMS_REQ,
    func: function (params, cb) {
      NAPI.updateIP(NET.uuid, '10.0.2.4', params, function (err, res) {
        t.ok(err, 'error returned: ' + JSON.stringify(params));
        if (!err) {
          return cb();
        }

        t.equal(err.statusCode, 422, 'status code');
        t.deepEqual(err.body, {
          code: 'InvalidParameters',
          errors: ['belongs_to_uuid', 'belongs_to_type', 'owner_uuid'].filter(
            function (p) { return !params.hasOwnProperty(p); }).map(
            function (p) { return helpers.missingParam(p, 'Missing parameter');
          }).sort(helpers.fieldSort),
          message: 'Missing parameters'
        }, 'Error body');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - both missing and invalid params (IP not in UFDS)'] =
  function (t) {

  helpers.ufdsReturnValues({
    get: [
      [null, NET],
      [new restify.ResourceNotFoundError('IP not found'), null]
    ]
  });

  NAPI.updateIP(NET.uuid, '10.0.2.4', { belongs_to_uuid: 'asdf' },
    function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      message: 'Invalid parameters',
      errors: [
        helpers.missingParam('belongs_to_type', 'Missing parameter'),
        helpers.invalidParam('belongs_to_uuid', 'invalid UUID'),
        helpers.missingParam('owner_uuid', 'Missing parameter')
      ]
    }, 'Error body');

    return t.done();
  });
};


exports['Update IP - both missing and invalid params (IP in UFDS)'] =
  function (t) {

  var ip = new IP({ ip: '10.0.2.4', network_uuid: NET.uuid, reserved: true});
  helpers.ufdsReturnValues({
    get: [
      [null, NET],
      [null, ip]
    ]
  });

  NAPI.updateIP(NET.uuid, '10.0.2.4', { belongs_to_uuid: 'asdf' },
    function (err, res) {
    t.ok(err, 'error returned');
    if (!err) {
      return t.done();
    }

    t.equal(err.statusCode, 422, 'status code');
    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      message: 'Invalid parameters',
      errors: [
        helpers.missingParam('belongs_to_type', 'Missing parameter'),
        helpers.invalidParam('belongs_to_uuid', 'invalid UUID'),
        helpers.missingParam('owner_uuid', 'Missing parameter')
      ]
    }, 'Error body');

    return t.done();
  });
};


/*
 * Allow updating all parameters
 */
exports['Update IP - valid param combinations (IP in UFDS)'] =
  function (t) {
  var ip = new IP({
    belongs_to_type: 'other',
    belongs_to_uuid: mod_uuid.v4(),
    ip: '10.0.2.4',
    network_uuid: NET.uuid,
    owner_uuid: mod_uuid.v4(),
    reserved: true
  });
  var ufdsReturn = { get: [], update: [] };
  var updateList = clone(MULTIPLE_PARAMS_REQ);
  updateList.push({ reserved: 'false' });
  updateList.push({ owner_uuid: mod_uuid.v4() });

  for (var i = 0; i < updateList.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([null, ip]);
    // And finally the update
    ufdsReturn.update.push([null, ip]);
  }
  helpers.ufdsReturnValues(ufdsReturn);

  // XXX: also do this for an update
  vasync.forEachParallel({
    inputs: updateList,
    func: function (params, cb) {
      NAPI.updateIP(NET.uuid, '10.0.2.4', params,
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
          return cb();
        }

        t.equal(res.statusCode, 200, 'status code: ' + JSON.stringify(params));
        t.deepEqual(obj, ip.serialize(), 'Response');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};



exports['Update IP - valid param combinations (IP not in UFDS)'] =
  function (t) {
  var ufdsReturn = { get: [], add: [] };
  var updateList = [
    { reserved: 'false' },
    { owner_uuid: mod_uuid.v4() },
    { belongs_to_uuid: mod_uuid.v4(),
      belongs_to_type: 'other',
      owner_uuid: mod_uuid.v4() }
  ];

  for (var i = 0; i < updateList.length; i++) {
    // One get for the network existence check
    ufdsReturn.get.push([null, NET]);
    // One get for the IP existence check
    ufdsReturn.get.push([new restify.ResourceNotFoundError(
      'IP not found'), null]);

    // And finally the add
    var ipParams = {
      ip: '10.0.2.4',
      network_uuid: NET.uuid
    };
    for (var p in updateList[i]) {
      ipParams[p] = updateList[i][p];
    }
    var retIP = new IP(ipParams);
    ufdsReturn.add.push([null, retIP]);
    updateList[i] = [updateList[i], retIP];
  }
  helpers.ufdsReturnValues(ufdsReturn);

  // XXX: also do this for an update
  vasync.forEachParallel({
    inputs: updateList,
    func: function (updateData, cb) {
      var params = updateData[0];
      var ip = updateData[1];

      NAPI.updateIP(NET.uuid, '10.0.2.4', params,
        function (err, obj, req, res) {
        t.ifError(err);
        if (err) {
          t.deepEqual(err.body, {}, 'error body: ' + JSON.stringify(params));
          return cb();
        }

        t.equal(res.statusCode, 200, 'status code: ' + JSON.stringify(params));
        t.deepEqual(obj, ip.serialize(), 'Response');

        return cb();
      });
    }
  }, function () {
    return t.done();
  });
};


exports['Update IP - free (IP in UFDS)'] = function (t) {
  var ip = new IP({ ip: '10.0.2.4', network_uuid: NET.uuid, reserved: true});
  helpers.ufdsReturnValues({
    get: [
      [null, NET],
      [null, ip]
    ],
    del: [
      null
    ]
  });

  NAPI.updateIP(NET.uuid, '10.0.2.4', { free: 'true' },
    function (err, obj, req, res) {
    t.ifError(err);
    if (err) {
      t.deepEqual(err.body, {}, 'error body');
      return t.done();
    }

    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      ip: '10.0.2.4',
      free: true,
      reserved: false
    }, 'Response');

    return t.done();
  });
};


exports['Update IP - free (IP not in UFDS)'] = function (t) {
  helpers.ufdsReturnValues({
    get: [
      [null, NET],
      [new restify.ResourceNotFoundError('IP not found'), null]
    ],
    del: [
      null
    ]
  });

  NAPI.updateIP(NET.uuid, '10.0.2.4', { free: 'true' },
    function (err, obj, req, res) {
    t.ifError(err);
    if (err) {
      t.deepEqual(err.body, {}, 'error body');
      return t.done();
    }

    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      ip: '10.0.2.4',
      free: true,
      reserved: false
    }, 'Response');

    return t.done();
  });
};


exports['Update IP - unassign (IP in UFDS)'] = function (t) {
  var ip = new IP({ ip: '10.0.2.4', network_uuid: NET.uuid, reserved: false});
  helpers.ufdsReturnValues({
    get: [
      [null, NET],
      [null, ip]
    ],
    update: [
      [null, ip]
    ]
  });

  NAPI.updateIP(NET.uuid, '10.0.2.4', { unassign: 'true' },
    function (err, obj, req, res) {
    t.ifError(err);
    if (err) {
      t.deepEqual(err.body, {}, 'error body');
      return t.done();
    }

    t.equal(res.statusCode, 200, 'status code');
    t.deepEqual(obj, {
      ip: '10.0.2.4',
      free: true,
      reserved: false
    }, 'Response');

    return t.done();
  });
};



// --- Teardown



exports['Stop server'] = function (t) {
  helpers.stopServer(function (err) {
    t.ifError(err, 'server stop');
    t.done();
  });
};
