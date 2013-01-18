/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /networks endpoints
 */

var helpers = require('./helpers');
var util = require('util');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



var napi = helpers.createNAPIclient();
var state = {
  testName: 'networks'
};
var adminUUID = '00000000-0000-0000-0000-000000000000';



// --- Helper functions



function validUFDSparams() {
  var uuid = UUID.v4();
  return {
    objectclass: 'network',
    uuid: uuid,
    networkname: uuid + '-name',
    vlan: 1024,
    subnetstartip: 3232238336,
    subnetbits: 24,
    provisionrangestartip: 3232238347,
    provisionrangeendip: 3232238586,
    nictagname: 'admin',
    gatewayip: 3232238347,
    resolverips: [ 134744072 ]
  };
}



// --- Setup



exports['create test nic tag'] = function (t) {
  helpers.createNicTag(t, napi, state);
};


exports['create second test nic tag'] = function (t) {
  helpers.createNicTag(t, napi, state, 'nicTag2');
};


exports['Create UFDS client'] = function (t) {
  helpers.createUFDSclient(t, state, function (err) {
    t.done();
  });
};



// --- Tests



exports['POST /networks (invalid nic tag)'] = function (t) {
  var params = {
    name: 'networks-integration-' + process.pid + '-invalid',
    vlan_id: 2,
    subnet: '10.77.77.0/24',
    provision_start_ip: '10.77.77.5',
    provision_end_ip: '10.77.77.250',
    nic_tag: 'invalid_tag',
    gateway: '10.77.77.1',
    resolvers: ['1.2.3.4', '10.77.77.2']
  };

  napi.createNetwork(params, function (err, res) {
    t.ok(err, 'error creating network');
    if (!err) {
      return t.done();
    }

    t.deepEqual(err.body, {
      code: 'InvalidParameters',
      message: 'Invalid parameters',
      errors: [
        {
          code: 'InvalidParameter',
          field: 'nic_tag',
          message: 'nic tag does not exist'
        }
      ]
    }, 'Error is correct');

    return t.done();
  });
};


exports['POST /networks'] = function (t) {
  var params = {
    name: 'networks-integration-' + process.pid,
    vlan_id: 0,
    subnet: '10.99.99.0/24',
    provision_start_ip: '10.99.99.5',
    provision_end_ip: '10.99.99.250',
    nic_tag: state.nicTag.name,
    gateway: '10.99.99.1',
    resolvers: ['1.2.3.4', '10.99.99.2']
  };

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      return t.done();
    }

    params.uuid = res.uuid;
    params.netmask = '255.255.255.0';
    state.network = res;
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

    return t.done();
  });
};


exports['Create network on second nic tag'] = function (t) {
  var params = {
    nic_tag: state.nicTag2.name
  };
  helpers.createNetwork(t, napi, state, params, 'network2');
};


exports['validate IPs created with network'] = function (t) {
  var ips = [ '10.99.99.1', '10.99.99.2'].reduce(function (arr, i) {
      arr.push(
        {ip: i, belongs_to_uuid: adminUUID, belongs_to_type: 'other',
          owner_uuid: adminUUID, reserved: true, free: false});
      return arr;
    }, []);

  var checkIP = function (params, cb) {
    napi.getIP(state.network.uuid, params.ip, function (err, res) {
      t.ifError(err, 'get IP: ' + params.ip);
      if (err) {
        return cb(err);
      }
      t.deepEqual(res, params, 'params for IP ' + params.ip);
      return cb();
    });
  };

  vasync.forEachParallel({
    func: checkIP,
    inputs: ips
  }, function (err) {
    return t.done();
  });
};


exports['GET /networks/:uuid'] = function (t) {
  napi.getNetwork(state.network.uuid, function (err, res) {
    t.ifError(err, 'get network: ' + state.network.uuid);
    if (err) {
      return t.done();
    }

    t.deepEqual(res, state.network, 'network params correct');
    return t.done();
  });
};


exports['GET /networks/admin'] = function (t) {
  napi.getNetwork('admin', function (err, res) {
    t.ifError(err, 'get admin network');
    if (err) {
      return t.done();
    }

    t.equal(res.name, 'admin', 'admin network found');
    return t.done();
  });
};


exports['GET /networks'] = function (t) {
  napi.listNetworks(function (err, res) {
    t.ifError(err, 'get networks');
    if (err) {
      return t.done();
    }

    t.ok(res.length > 0, 'have networks in list');

    var found = false;

    for (var n in res) {
      if (res[n].uuid == state.network.uuid) {
        found = true;
        t.deepEqual(res[n], state.network, 'network params in list');
        break;
      }
    }

    t.ok(found, 'found the test network');
    return t.done();
  });
};


exports['GET /networks (filtered)'] = function (t) {
  var filter = {
    name: state.network.name
  };
  var desc = util.format(' (name=%s)', filter.name);

  napi.listNetworks(filter, function (err, res) {
    t.ifError(err, 'get networks' + desc);
    t.ok(res, 'list returned' + desc);
    if (err || !res) {
      return t.done();
    }

    t.equal(res.length, 1, 'only matches one network' + desc);
    t.deepEqual(res[0], state.network, 'network params match' + desc);
    return t.done();
  });
};


exports['GET /networks (filter: multiple nic tags)'] = function (t) {
  var filters = [
    { nic_tag: [ state.nicTag.name, state.nicTag2.name ] },
    { nic_tag: state.nicTag.name + ',' + state.nicTag2.name }
  ];

  var filterList = function (filter, cb) {
    var desc = util.format(' (nic_tag=%j)', filter.nic_tag);

    napi.listNetworks(filter, function (err, res) {
      t.ifError(err, 'get networks' + desc);
      t.ok(res, 'list returned' + desc);
      if (err || !res) {
        return t.done();
      }

      var found = 0;
      t.equal(res.length, 2, 'matches two networks' + desc);
      for (var n in res) {
        if (res[n].uuid == state.network.uuid) {
          found++;
          t.deepEqual(res[n], state.network, 'network params in list');
          continue;
        }

        if (res[n].uuid == state.network2.uuid) {
          found++;
          t.deepEqual(res[n], state.network2, 'network2 params in list');
          continue;
        }
      }

      t.equal(found, 2, 'both networks found');
      return cb();
    });
  };

  vasync.forEachParallel({
    func: filterList,
    inputs: filters
  }, function (err) {
    t.done();
  });

};


exports['UFDS validation'] = function (t) {
  /* jsl:ignore (for regex warning */
  var invalid = [
    [ { uuid: 'foo' }, 'network uuid' ],

    [ { subnetstartip: 'foo' }, 'Subnet start IP' ],
    [ { subnetstartip: -1 }, 'Subnet start IP' ],
    [ { subnetstartip: 4294967296 }, 'Subnet start IP' ],

    [ { provisionrangestartip: 'foo' }, 'Provision range start IP' ],
    [ { provisionrangestartip: -1 }, 'Provision range start IP' ],
    [ { provisionrangestartip: 4294967296 }, 'Provision range start IP' ],
    // Outside the subnet:
    [ { provisionrangestartip: 3232238335 },
      'Provision range start IP cannot be before the subnet start IP' ],
    [ { provisionrangestartip: 3232238592 },
      'Provision range start IP cannot be after the subnet end IP' ],

    [ { provisionrangeendip: 'foo' }, 'Provision range end IP' ],
    [ { provisionrangeendip: -1 }, 'Provision range end IP' ],
    [ { provisionrangeendip: 4294967296 }, 'Provision range end IP' ],
    // Outside the subnet:
    [ { provisionrangeendip: 3232238335 },
      'Provision range end IP cannot be before the subnet start IP' ],
    [ { provisionrangeendip: 3232238592 },
      'Provision range end IP cannot be after the subnet end IP' ],

    [ { gatewayip: 'foo' }, 'Gateway IP' ],
    [ { gatewayip: -1 }, 'Gateway IP' ],
    [ { gatewayip: 4294967296 }, 'Gateway IP' ],
    // Outside the subnet:
    [ { gatewayip: 3232238335 },
      'Gateway IP must be within the subnet' ],
    [ { gatewayip: 3232238592 },
      'Gateway IP must be within the subnet' ],

    [ { subnetbits: 'foo' }, 'subnet bits' ],
    [ { subnetbits: 7 }, 'subnet bits' ],
    [ { subnetbits: 33 }, 'subnet bits' ],

    [ { vlan: 'foo' }, 'VLAN ID' ],
    [ { vlan: 1 }, 'VLAN ID' ],
    [ { vlan: -1 }, 'VLAN ID' ],
    [ { vlan: 4095 }, 'VLAN ID' ],

    [ { resolverips: ['foo'] }, 'Resolver IP' ],
    [ { resolverips: [ -1 ] }, 'Resolver IP' ],
    [ { resolverips: [ 4294967296 ] }, 'Resolver IP' ],
    [ { resolverips: [ 134744072, 134743044, 3232238338, 3232238339,
      33232238341, 232238340 ] }, 'Resolver IP' ],

    // Provision start IP > provision end IP
    [ { provisionrangestartip: 3232238365,
        provisionrangeendip: 3232238355,
       },
      'Provision range start IP cannot be after the provision range end IP' ]
  ];
  /* jsl:end */

  var ufdsAdd = function (toTest, cb) {
    var desc = util.format(' (%j)', toTest[0]);
    var params = validUFDSparams();
    var dn = util.format('uuid=%s, ou=networks', params.uuid);
    for (var p in toTest[0]) {
      params[p] = toTest[0][p];
    }

    helpers.ufdsAdd(state, dn, params, function (err) {
      t.ok(err, 'Error should be returned' + desc);
      if (err) {
        helpers.similar(t, err.message, toTest[1],
          util.format('Error message matches "%s"', err.message));
      }

      cb(null);
    });
  };

  vasync.forEachParallel({
    func: ufdsAdd,
    inputs: invalid
  }, function (err) {
    t.done();
  });
};


exports['POST /networks (empty gateway)'] = function (t) {
  var params = {
    name: 'networks-integration-' + process.pid + '-3',
    vlan_id: 0,
    subnet: '10.99.99.0/24',
    provision_start_ip: '10.99.99.5',
    provision_end_ip: '10.99.99.250',
    nic_tag: state.nicTag.name,
    gateway: '',
    resolvers: ['1.2.3.4', '10.99.99.2']
  };

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      return t.done();
    }

    params.uuid = res.uuid;
    params.netmask = '255.255.255.0';
    delete params.gateway;
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);
    state.network3 = res;

    return t.done();
  });
};


exports['POST /networks (single resolver)'] = function (t) {
  var params = {
    name: 'networks-integration-single-resolver-' + process.pid,
    vlan_id: 104,
    subnet: '192.168.0.0/16',
    provision_start_ip: '192.168.0.5',
    provision_end_ip: '192.168.255.250',
    nic_tag: state.nicTag.name,
    gateway: '192.168.0.1',
    resolvers: ['8.8.4.4']
  };

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      return t.done();
    }

    params.uuid = res.uuid;
    params.netmask = '255.255.0.0';
    state.singleResolver = res;
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

    napi.getNetwork(res.uuid, function (err2, res2) {
      t.ifError(err2, 'create network');
      if (err2) {
        return t.done();
      }

      t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
      return t.done();
    });
  });
};


exports['POST /networks (comma-separated resolvers)'] = function (t) {
  var params = {
    name: 'networks-integration-comma-resolver-' + process.pid,
    vlan_id: 105,
    subnet: '192.168.0.0/16',
    provision_start_ip: '192.168.0.5',
    provision_end_ip: '192.168.255.250',
    nic_tag: state.nicTag.name,
    gateway: '192.168.0.1',
    resolvers: '8.8.4.4,192.168.0.1'
  };

  napi.createNetwork(params, function (err, res) {
    t.ifError(err, 'create network');
    if (err) {
      return t.done();
    }

    params.uuid = res.uuid;
    params.netmask = '255.255.0.0';
    params.resolvers = ['8.8.4.4', '192.168.0.1'];
    state.commaResolvers = res;
    t.deepEqual(res, params, 'parameters returned for network ' + res.uuid);

    napi.getNetwork(res.uuid, function (err2, res2) {
      t.ifError(err2, 'create network');
      if (err2) {
        return t.done();
      }

      t.deepEqual(res2, params, 'get parameters for network ' + res.uuid);
      return t.done();
    });
  });
};


// --- Teardown



exports['Tear down UFDS client'] = function (t) {
  helpers.destroyUFDSclient(t, state);
};


exports['DELETE /networks/:uuid'] = function (t) {
  var names = ['network', 'network2', 'network3', 'singleResolver',
    'commaResolvers'];

  var deleteNet = function (n, cb) {
    if (!state.hasOwnProperty(n)) {
      return cb();
    }
    napi.deleteNetwork(state[n].uuid, { force: true }, function (err) {
      t.ifError(err, 'delete network ' + n);
      return cb();
    });
  };

  vasync.forEachParallel({
    func: deleteNet,
    inputs: names
  }, function (err) {
    return t.done();
  });
};


exports['remove test nic tag'] = function (t) {
  helpers.deleteNicTag(t, napi, state);
};


exports['remove second test nic tag'] = function (t) {
  helpers.deleteNicTag(t, napi, state, 'nicTag2');
};
