/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /nics and /networks/:uuid/nics endpoints
 */

var helpers = require('./helpers');
var mod_err = require('../../lib/util/errors');
var util = require('util');
var util_mac = require('../../lib/util/mac');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals



// Set this to any of the exports in this file to only run that test,
// plus setup and teardown
var runOne;
var napi = helpers.createNAPIclient();
var netParams = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers'];
var state = {
  nic: {},
  ip: {},
  desc: {}
};
var uuids = {
  admin: helpers.ufdsAdminUuid,
  a: '564d69b1-a178-07fe-b36f-dfe5fa3602e2',
  b: '91abd897-566a-4ae5-80d2-1ba103221bbc',
  c: 'e8e2deb9-2d68-4e4e-9aa6-4962c879d9b1',
  d: UUID.v4()
};



// --- Helper functions



function addNetworkParams(params) {
  for (var n in netParams) {
    params[netParams[n]] = state.network[netParams[n]];
  }
  params.network_uuid = state.network.uuid;
}



// --- Setup



exports['setup'] = function (t) {
  helpers.createNicTags(t, napi, state,
    ['nicTag', 'nicTag2', 'nicTag3', 'nicTag4', 'nicTag5'], function (err) {
    if (err) {
      return t.done();
    }

    helpers.createNetwork(t, napi, state, { gateway: '10.99.99.4' });
  });
};



// --- Tests



exports['POST /nics (basic)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: basic: no IP]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    params.primary = false;
    params.mac = mac;
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.a = params;
    state.desc.a = desc;

    return t.done();
  });
};


exports['POST /nics (with IP and network)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    ip: '10.99.99.77',
    network_uuid: state.network.uuid
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with IP and network]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.b = params;
    state.desc.b = desc;
    state.ip.b = params.ip;

    return t.done();
  });
};


exports['POST /nics (with IP but no network)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    ip: '10.99.99.79',
    nic_tag: state.network.nic_tag,
    vlan_id: state.network.vlan_id,
    nic_tags_provided: [ 'external' ]
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with IP but no network]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.c = params;
    state.desc.c = desc;
    state.ip.c = params.ip;

    return t.done();
  });
};


exports['POST /nics (with IP already reserved)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    ip: state.network.gateway,
    nic_tag: state.network.nic_tag,
    vlan_id: state.network.vlan_id
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with IP already reserved]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.resNic1 = params;
    state.desc.resNic1 = desc;

    return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
      t.ifError(err2, 'get IP ' + params.ip + desc);
      if (err2) {
        return t.done();
      }

      var exp = {
        ip: params.ip,
        owner_uuid: params.owner_uuid,
        belongs_to_type: params.belongs_to_type,
        belongs_to_uuid: params.belongs_to_uuid,
        reserved: true,
        free: false
      };
      t.deepEqual(res2, exp, 'IP params correct: ' + params.ip + desc);

      return t.done();
    });
  });
};


exports['POST /networks/:uuid/nics (basic)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  napi.provisionNic(state.network.uuid, params, function (err, res) {
    if (err) {
      return helpers.doneWithError(t, err,
        'provision nic [network nic - no IP]');
    }
    var desc = util.format(' [%s: network nic - no IP]', res.mac);

    params.primary = false;
    params.mac = res.mac;
    params.ip = res.ip;
    addNetworkParams(params);

    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.d = params;
    state.desc.d = desc;
    state.ip.d = params.ip;
    return t.done();
  });
};


exports['POST /networks/:uuid/nics (with IP)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    ip: '10.99.99.201'
  };
  napi.provisionNic(state.network.uuid, params, function (err, res) {
    t.ifError(err, 'provision nic [network nic - with IP]');
    if (err) {
      return t.done();
    }
    var desc = util.format(' [%s: network nic - with IP]', res.mac);

    params.primary = false;
    params.mac = res.mac;
    addNetworkParams(params);

    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.e = params;
    state.desc.e = desc;
    state.ip.e = params.ip;
    return t.done();
  });
};


exports['Check IPs are created along with nics'] = function (t) {
  var ips = ['b', 'c', 'd', 'e'];

  var checkIP = function (ipNum, cb) {
    var ip = state.ip[ipNum];
    napi.getIP(state.network.uuid, ip, function (err, res) {
      var desc = util.format(' %s/%s%s',
        state.network.uuid, ip, state.desc[ipNum]);
      t.ifError(err, 'get IP' + desc);
      if (err) {
        return cb();
      }

      var exp = {
        ip: ip,
        owner_uuid: uuids.b,
        belongs_to_type: 'server',
        belongs_to_uuid: uuids.a,
        reserved: false,
        free: false
      };
      t.deepEqual(res, exp, 'IP params correct' + desc);
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


exports['POST /nics (with reserved IP)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    network_uuid: state.network.uuid,
    reserved: true
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with reserved IP]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    delete params.reserved;
    params.primary = false;
    params.mac = mac;
    params.ip = res.ip;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.resNic2 = res;
    state.desc.resNic2 = desc;

    // IP should be reserved
    return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
      t.ifError(err2, 'get IP ' + params.ip + desc);
      if (err2) {
        return t.done();
      }

      var exp = {
        ip: params.ip,
        owner_uuid: params.owner_uuid,
        belongs_to_type: params.belongs_to_type,
        belongs_to_uuid: params.belongs_to_uuid,
        reserved: true,
        free: false
      };
      t.deepEqual(res2, exp, 'IP params correct: ' + params.ip + desc);

      return t.done();
    });
  });
};


exports['POST /nics (with model)'] = function (t) {
  var desc;
  var mac = helpers.randomMAC();
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    model: 'virtio'
  };

  vasync.pipeline({
  funcs: [
    function (_, cb) {
      napi.createNic(mac, params, function (err, res) {
        desc = util.format(' [%s: with model]', mac);
        t.ifError(err, 'provision nic' + desc);
        if (err) {
          return t.done();
        }

        params.primary = false;
        params.mac = mac;
        t.deepEqual(res, params, 'nic params returned' + desc);
        state.nic.model = params;
        state.desc.model = desc;

        return cb();
      });

    }, function (_, cb) {
      napi.getNic(mac, function (err, res) {
        t.ifError(err, 'get nic' + desc);
        if (err) {
          return cb(err);
        }

        t.deepEqual(res, params, 'nic params returned' + desc);
        return cb();
      });

    }, function (_, cb) {
      napi.updateNic(mac, { model: 'e1000' }, function (err, res) {
        t.ifError(err, 'update nic' + desc);
        if (err) {
          return t.done();
        }

        params.model = 'e1000';
        t.deepEqual(res, params, 'updated nic params returned' + desc);
        return cb();
      });

    }, function (_, cb) {
      napi.getNic(mac, function (err, res) {
        t.ifError(err, 'get nic' + desc);
        if (err) {
          return cb(err);
        }

        t.deepEqual(res, params, 'nic params returned' + desc);
        return cb();
      });
    }
  ]}, function () {
    return t.done();
  });
};


exports['POST /nics (duplicate nic)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();
  var desc = util.format(' [%s: duplicate nic]', mac);

  napi.createNic(mac, params, function (err, res) {
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    params.primary = false;
    t.equal(res.mac, mac, 'mac correct');

    napi.createNic(mac, params, function (err2) {
      t.ok(err2, 'error creating duplicate nic');
      if (!err2) {
        return t.done();
      }

      t.equal(err2.statusCode, 422, 'status code');
      t.deepEqual(err2.body, helpers.invalidParamErr({
        errors: [ mod_err.duplicateParam('mac') ]
      }), 'Error body');

      return t.done();
    });
  });
};


exports['DELETE /nics/:mac (with reserved IP)'] = function (t) {
  var delNic = function (name, cb) {
    var nic = state[name];
    var desc = state.desc[name];

    return napi.deleteNic(nic.mac, function (err) {
      t.ifError(err, 'delete nic' + desc);
      if (err) {
        return cb(err);
      }

      return napi.getIP(state.network.uuid, nic.ip,
        function (err2, res2) {
        t.ifError(err2, 'get IP ' + nic.ip + desc);

        // A reserved IP should keep its owner information
        var exp = {
          ip: nic.ip,
          owner_uuid: nic.owner_uuid,
          reserved: true,
          free: false
        };
        t.deepEqual(res2, exp, 'IP params correct: ' + nic.ip
          + desc);

        return cb();
      });
    });
  };

  vasync.forEachParallel({
    func: delNic,
    inputs: ['resNic1', 'resNic2']
  }, function (err) {
    return t.done();
  });
};


exports['GET /nics/:mac'] = function (t) {
  var nics = ['a', 'b', 'c', 'd', 'e'];

  var checkNic = function (nicNum, cb) {
    var nic = state.nic[nicNum];
    var desc = state.desc[nicNum];
    napi.getNic(nic.mac, function (err, res) {
      t.ifError(err, 'get nic' + desc);
      if (err) {
        return cb(err);
      }
      t.deepEqual(res, nic, 'get params' + desc);
      return cb();
    });
  };

  vasync.forEachParallel({
    func: checkNic,
    inputs: nics
  }, function (err) {
    return t.done();
  });
};


exports['PUT /nics/:mac'] = function (t) {
  var nics = ['a', 'b', 'd'];
  var params = {
    owner_uuid: uuids.c,
    belongs_to_uuid: uuids.d,
    belongs_to_type: 'other',
    nic_tags_provided: [ state.nicTag.name ]
  };

  var updateNic = function (nicNum, cb) {
    var nic = state.nic[nicNum];
    var desc = state.desc[nicNum];

    napi.updateNic(nic.mac, params, function (err, res) {
      t.ifError(err, 'update nic' + desc);
      for (var p in params) {
        nic[p] = params[p];
      }
      t.deepEqual(res, nic, 'updated params' + desc);

      napi.getNic(nic.mac, function (err2, res2) {
        t.ifError(err2, 'get updated nic' + desc);
        if (err2) {
          return cb(err2);
        }
        t.deepEqual(res2, nic, 'get updated params' + desc);
        return cb();
      });
    });
  };

  vasync.forEachParallel({
    func: updateNic,
    inputs: nics
  }, function (err) {
    return t.done();
  });
};


exports['Check IPs are updated along with nics'] = function (t) {
  var ips = ['b', 'd'];

  var checkIP = function (ipNum, cb) {
    var ip = state.ip[ipNum];
    var desc = util.format(' %s/%s%s',
      state.network.uuid, ip, state.desc[ipNum]);
    napi.getIP(state.network.uuid, ip, function (err, res) {
      t.ifError(err, 'get updated IP' + desc);
      if (err) {
        return cb();
      }

      var exp = {
        ip: ip,
        owner_uuid: uuids.c,
        belongs_to_uuid: uuids.d,
        belongs_to_type: 'other',
        reserved: false,
        free: false
      };
      t.deepEqual(res, exp, 'Updated IP params correct' + desc);
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


exports['PUT /nics (with network_uuid)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    state.nic.putIPnetUUID = params;
    state.desc.putIPnetUUID = desc;

    var updateParams = { network_uuid: state.network.uuid };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ifError(err2, 'update nic' + desc);
      if (err2) {
        return t.done();
      }

      params.primary = false;
      params.mac = mac;
      params.ip = res2.ip;
      addNetworkParams(params);
      t.ok(res2.ip, 'nic now has IP address');
      t.deepEqual(res2, params, 'nic params returned' + desc);
      state.nic.putIPnetUUID = params;
      state.ip.putIPnetUUID = res2.ip;

      if (!res2.ip || !state.network.uuid) {
        t.ok(false, util.format(
          'Not all params present: ip=%s, network_uuid=%s', res2.ip,
          state.network.uuid));
        return t.done();
      }

      napi.getIP(state.network.uuid, res2.ip, function (err3, res3) {
        t.ifError(err3, 'get IP' + desc);
        if (err) {
          return t.done();
        }

        var exp = {
          ip: res2.ip,
          owner_uuid: uuids.b,
          belongs_to_type: 'server',
          belongs_to_uuid: uuids.a,
          reserved: false,
          free: false
        };
        t.deepEqual(res3, exp, 'IP params correct' + desc);

        return t.done();
      });
    });
  });
};


exports['GET /networks/admin'] = function (t) {
  napi.getNetwork('admin', function (err, res) {
    t.ifError(err, 'get admin network');
    if (err) {
      return t.done();
    }

    t.equal(res.name, 'admin', 'admin network found');
    state.adminNet = res;
    return t.done();
  });
};


// Note that this is the only test in this entire suite that affects
// networks used in production. This functionality is absolutely
// necessary for booter, so we should still make sure to test it
exports['PUT /nics (with network_uuid set to admin)'] = function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid set to admin]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    state.nic.putIPwithName = params;
    state.desc.putIPwithName = desc;

    var updateParams = { network_uuid: 'admin' };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ifError(err2, 'update nic' + desc);
      if (err2) {
        return t.done();
      }

      params.primary = false;
      params.mac = mac;
      params.ip = res2.ip;

      for (var n in netParams) {
        if (state.adminNet.hasOwnProperty(netParams[n])) {
          params[netParams[n]] = state.adminNet[netParams[n]];
        }
      }
      params.network_uuid = state.adminNet.uuid;

      t.deepEqual(res2, params, 'nic params returned' + desc);
      state.nic.putIPwithName = params;
      state.ip.putIPwithName = res2.ip;

      napi.getIP(state.adminNet.uuid, res2.ip, function (err3, res3) {
        t.ifError(err3, 'get IP' + desc);
        if (err) {
          return t.done();
        }

        var exp = {
          ip: res2.ip,
          owner_uuid: uuids.b,
          belongs_to_type: 'server',
          belongs_to_uuid: uuids.a,
          reserved: false,
          free: false
        };
        t.deepEqual(res3, exp, 'IP params correct' + desc);

        return t.done();
      });
    });
  });
};


exports['PUT /nics (with network_uuid set to invalid name)'] = function (t) {
  // Only network_uuid=admin is allowed
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid set to name]', mac);
    t.ifError(err, 'provision nic' + desc);
    if (err) {
      return t.done();
    }

    state.nic.putIPwithInvalidName = params;
    state.desc.putIPwithInvalidName = desc;

    var updateParams = { network_uuid: state.network.name };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ok(err2, 'expected error');
      if (!err2) {
        return t.done();
      }

      // XXX: we end up with a stringified JSON object here, which is
      // definitely a bug somewhere.
      t.notEqual(err2.message,
        util.format('Unknown network "%s"', state.network.name),
        'Error message correct');
      return t.done();
    });
  });
};


exports['GET /nics (filtered by belongs_to_uuid)'] = function (t) {
  var filter = { belongs_to_uuid: uuids.d };
  var nics = ['a', 'b', 'd'].reduce(function (r, n) {
    r[state.nic[n].mac] = n;
    return r;
  }, {});

  napi.listNics(filter, function (err, res) {
    t.ifError(err, 'get nics');

    // Since we generated this UUID at the beginning of this test, only
    // the updated nics should be in the list

    var found = 0;
    t.ok(res.length !== 0, 'nics in list');

    for (var i = 0; i < res.length; i++) {
      var cur = res[i];
      if (!nics.hasOwnProperty(cur.mac)) {
        t.ok(false, cur.mac + ' returned in list but should not be');
        continue;
      }

      var params = state.nic[nics[cur.mac]];
      var desc = state.desc[nics[cur.mac]];
      t.deepEqual(cur, params, 'list nic matches' + desc);
      found++;
    }

    t.equal(found, res.length, 'all nics found in list');
    return t.done();
  });
};


exports['GET /nics (filtered)'] = function (t) {
  var filters = [
    { belongs_to_type: 'other' },
    { owner_uuid: uuids.b },
    { nic_tag: state.nicTag.name }
  ];

  var listNics = function (filter, cb) {
    napi.listNics(filter, function (err, res) {
      t.ifError(err, 'get nics: ' + JSON.stringify(filter));

      t.ok(res.length !== 0, 'nics in list: ' + JSON.stringify(filter));

      for (var i = 0; i < res.length; i++) {
        var cur = res[i];
        for (var f in filter) {
          if (cur[f] != filter[f]) {
            t.equal(cur[f], filter[f],
              util.format('nic "%s" does not match filter %s=%s: %j',
              cur.mac, f, filter[f], cur));
            return cb();
          }
        }
      }

      return cb();
    });
  };

  vasync.forEachParallel({
    func: listNics,
    inputs: filters
  }, function (err) {
    return t.done();
  });
};


exports['POST /nics (nic_tags_provided)'] = function (t) {
  var params1 = {
    owner_uuid: uuids.b,
    belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
    belongs_to_type: 'server',
    nic_tags_provided: [state.nicTag2.name]
  };
  var params2 = {
    owner_uuid: uuids.b,
    belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
    belongs_to_type: 'server',
    nic_tags_provided: [state.nicTag3.name]
  };

  napi.createNic(helpers.randomMAC(), params1, function (err, res) {
    t.ifError(err, 'create nic 1');
    if (err) {
      return t.done();
    }
    state.nic.f = res;
    state.desc.f = util.format(' [%s: nic_tags_provided nic 1]', res.mac);
    t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
      'nic 1 nic_tags_provided');

    napi.createNic(helpers.randomMAC(), params2, function (err2, res2) {
      t.ifError(err2, 'create nic 2');
      if (err2) {
        return t.done();
      }

      state.nic.g = res2;
      state.desc.g = util.format(' [%s: nic_tags_provided nic 2]', res2.mac);
      t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
        'nic 2 nic_tags_provided');

      return t.done();
    });
  });
};


exports['POST /nics (nic_tags_provided scalar)'] = function (t) {
  vasync.pipeline({
    funcs: [
    function (_, cb) {
      var params1 = {
        owner_uuid: uuids.b,
        belongs_to_uuid: '564de095-df3c-43a5-a55c-d33c68c7af5e',
        belongs_to_type: 'server',
        nic_tags_provided: util.format('%s,%s', state.nicTag4.name,
          state.nicTag5.name)
      };

      napi.createNic(helpers.randomMAC(), params1, function (err, res) {
        t.ifError(err, 'create nic 1');
        if (err) {
          return cb(err);
        }

        state.nic.ntps1 = res;
        state.desc.ntps1 = util.format(
          ' [%s: nic_tags_provided scalar nic 1]', res.mac);
        t.deepEqual(res.nic_tags_provided, [state.nicTag4.name,
          state.nicTag5.name], 'nic 1 nic_tags_provided');

        return cb();
      });

    }, function (_, cb) {
      var updateParams = {
        nic_tags_provided: util.format('%s,%s', state.nicTag5.name,
          state.nicTag4.name)
      };

      napi.updateNic(state.nic.ntps1.mac, updateParams, function (err, res) {
        t.ifError(err, 'update nic 1');
        if (err) {
          return cb(err);
        }

        t.deepEqual(res.nic_tags_provided, [state.nicTag5.name,
          state.nicTag4.name], 'nic 1 nic_tags_provided');

        return cb();
      });
    }]
  }, function () {
    return t.done();
  });
};


exports['GET /nics (filter: nic_tags_provided)'] = function (t) {
  var filter = {
    nic_tags_provided: [state.nicTag2.name, state.nicTag3.name]
  };

  napi.listNics(filter, function (err, res) {
    t.ifError(err, 'get nics: ' + JSON.stringify(filter));
    if (err) {
      return t.done();
    }
    t.equal(res.length, 2, '2 nics returned');

    if (res.length === 0) {
      return t.done();
    }

    var macs = res.reduce(function (arr, x) {
      arr.push(x.mac);
      return arr;
    }, []).sort();

    t.deepEqual(macs, [state.nic.f.mac, state.nic.g.mac].sort(),
      'both nics returned');
    return t.done();
  });
};


exports['DELETE /nics/:mac'] = function (t) {
  var nics = Object.keys(state.nic);

  var delNic = function (nicNum, cb) {
    var nic = state.nic[nicNum];
    var desc = state.desc[nicNum];

    return napi.deleteNic(nic.mac, function (err, res) {
      t.ifError(err, 'delete nic ' + nic.mac + desc);
      if (err) {
        return cb();
      }

      return napi.getNic(nic.mac, function (err2, res2) {
        t.ok(err2, 'error getting deleted nic' + desc);
        if (!err) {
          return cb();
        }
        t.equal(err2.code, 'ResourceNotFound', '404 on deleted nic' + desc);

        return cb();
      });
    });
  };

  vasync.forEachParallel({
    func: delNic,
    inputs: nics
  }, function (err) {
    return t.done();
  });
};


exports['Check IPs are freed along with nics'] = function (t) {
  var ips = Object.keys(state.ip);

  var checkIP = function (ipNum, cb) {
    var ip = state.ip[ipNum];
    var desc = util.format(' %s/%s%s',
      state.network.uuid, ip, state.desc[ipNum]);

    if (!ip) {
      t.ok(false, 'IP "' + ipNum + '" does not exist:' + desc);
      return cb();
    }

    napi.getIP(state.network.uuid, ip, function (err, res) {
      t.ifError(err, 'get updated IP' + desc);
      if (err) {
        return cb();
      }

      var exp = {
        ip: ip,
        reserved: false,
        free: true
      };
      t.deepEqual(res, exp, 'Updated IP params correct' + desc);
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



// --- Teardown



exports['teardown'] = function (t) {
  helpers.deleteNetwork(t, napi, state, function () {
    helpers.deleteNicTags(t, napi, state);
  });
};


// Use to run only one test in this file:
if (runOne) {
  module.exports = {
    setup: exports.setup,
    oneTest: runOne,
    teardown: exports.teardown
  };
}
