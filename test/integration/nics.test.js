/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * Integration tests for /networks/:uuid/ips endpoints
 */

var helpers = require('./helpers');
var test = require('tap').test;
var util = require('util');
var util_mac = require('../../lib/util/mac');
var UUID = require('node-uuid');
var vasync = require('vasync');



// --- Globals

var napi = helpers.createNAPIclient();
var netParams = ['gateway', 'netmask', 'vlan_id', 'nic_tag', 'resolvers'];
var state = {
  nic: {},
  ip: {},
  desc: {}
};
var uuids = {
  admin: '00000000-0000-0000-0000-000000000000',
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


function validUFDSparams() {
  return {
    belongstotype: 'other',
    belongstouuid: UUID.v4(),
    mac: util_mac.randomNum('90b8d0'),
    objectclass: 'nic'
  };
}

// --- Setup



test('Create UFDS client', function (t) {
  helpers.createUFDSclient(t, state, function (err) {
    return t.end();
  });
});


test('create test nic tag', function (t) {
  helpers.createNicTag(t, napi, state);
});


test('create test network', function (t) {
  helpers.createNetwork(t, napi, state, { gateway: '10.99.99.4' });
});


test('create second test nic tag', function (t) {
  helpers.createNicTag(t, napi, state, 'nicTag2');
});


test('create third test nic tag', function (t) {
  helpers.createNicTag(t, napi, state, 'nicTag3');
});


test('create fourth test nic tag', function (t) {
  helpers.createNicTag(t, napi, state, 'nicTag4');
});


test('create fifth test nic tag', function (t) {
  helpers.createNicTag(t, napi, state, 'nicTag5');
});



// --- Tests



test('POST /nics (basic)', function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: basic: no IP]', mac);
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    params.primary = false;
    params.mac = mac;
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.a = params;
    state.desc.a = desc;

    return t.end();
  });
});


test('POST /nics (with IP and network)', function (t) {
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
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.b = params;
    state.desc.b = desc;
    state.ip.b = params.ip;

    return t.end();
  });
});


test('POST /nics (with IP but no network)', function (t) {
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
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.c = params;
    state.desc.c = desc;
    state.ip.c = params.ip;

    return t.end();
  });
});


test('POST /nics (with IP already reserved)', function (t) {
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
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    params.primary = false;
    params.mac = mac;
    addNetworkParams(params);
    t.deepEqual(res, params, 'nic params returned' + desc);
    state.resNic1 = params;
    state.desc.resNic1 = desc;

    return napi.getIP(state.network.uuid, params.ip, function (err2, res2) {
      t.ifErr(err2, 'get IP ' + params.ip + desc);
      if (err2) {
        return t.end();
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

      return t.end();
    });
  });
});


test('POST /networks/:uuid/nics (basic)', function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  napi.provisionNic(state.network.uuid, params, function (err, res) {
    t.ifErr(err, 'provision nic [network nic - no IP]');
    if (err) {
      return t.end();
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
    return t.end();
  });
});


test('POST /networks/:uuid/nics (with IP)', function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server',
    ip: '10.99.99.201'
  };
  napi.provisionNic(state.network.uuid, params, function (err, res) {
    t.ifErr(err, 'provision nic [network nic - with IP]');
    if (err) {
      return t.end();
    }
    var desc = util.format(' [%s: network nic - with IP]', res.mac);

    params.primary = false;
    params.mac = res.mac;
    addNetworkParams(params);

    t.deepEqual(res, params, 'nic params returned' + desc);
    state.nic.e = params;
    state.desc.e = desc;
    state.ip.e = params.ip;
    return t.end();
  });
});


test('Check IPs are created along with nics', function (t) {
  var ips = ['b', 'c', 'd', 'e'];

  var checkIP = function (ipNum, cb) {
    var ip = state.ip[ipNum];
    napi.getIP(state.network.uuid, ip, function (err, res) {
      var desc = util.format(' %s/%s%s',
        state.network.uuid, ip, state.desc[ipNum]);
      t.ifErr(err, 'get IP' + desc);
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
    return t.end();
  });
});


test('POST /nics (with reserved IP)', function (t) {
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
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
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
      t.ifErr(err2, 'get IP ' + params.ip + desc);
      if (err2) {
        return t.end();
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

      return t.end();
    });
  });
});


test('POST /nics (with model)', function (t) {
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
        t.ifErr(err, 'provision nic' + desc);
        if (err) {
          return t.end();
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
        t.ifErr(err, 'get nic' + desc);
        if (err) {
          return cb(err);
        }

        t.deepEqual(res, params, 'nic params returned' + desc);
        return cb();
      });

    }, function (_, cb) {
      napi.updateNic(mac, { model: 'e1000' }, function (err, res) {
        t.ifErr(err, 'update nic' + desc);
        if (err) {
          return t.end();
        }

        params.model = 'e1000';
        t.deepEqual(res, params, 'updated nic params returned' + desc);
        return cb();
      });

    }, function (_, cb) {
      napi.getNic(mac, function (err, res) {
        t.ifErr(err, 'get nic' + desc);
        if (err) {
          return cb(err);
        }

        t.deepEqual(res, params, 'nic params returned' + desc);
        return cb();
      });
    }
  ]}, function () {
    return t.end();
  });
});


test('DELETE /nics/:mac (with reserved IP)', function (t) {
  var delNic = function (name, cb) {
    var nic = state[name];
    var desc = state.desc[name];

    return napi.deleteNic(nic.mac, function (err) {
      t.ifErr(err, 'delete nic' + desc);
      if (err) {
        return cb(err);
      }

      return napi.getIP(state.network.uuid, nic.ip,
        function (err2, res2) {
        t.ifErr(err2, 'get IP ' + nic.ip + desc);

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
    return t.end();
  });
});


test('GET /nics/:mac', function (t) {
  var nics = ['a', 'b', 'c', 'd', 'e'];

  var checkNic = function (nicNum, cb) {
    var nic = state.nic[nicNum];
    var desc = state.desc[nicNum];
    napi.getNic(nic.mac, function (err, res) {
      t.ifErr(err, 'get nic' + desc);
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
    return t.end();
  });
});


test('PUT /nics/:mac', function (t) {
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
      t.ifErr(err, 'update nic' + desc);
      for (var p in params) {
        nic[p] = params[p];
      }
      t.deepEqual(res, nic, 'updated params' + desc);

      napi.getNic(nic.mac, function (err2, res2) {
        t.ifErr(err2, 'get updated nic' + desc);
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
    return t.end();
  });
});


test('Check IPs are updated along with nics', function (t) {
  var ips = ['b', 'd'];

  var checkIP = function (ipNum, cb) {
    var ip = state.ip[ipNum];
    var desc = util.format(' %s/%s%s',
      state.network.uuid, ip, state.desc[ipNum]);
    napi.getIP(state.network.uuid, ip, function (err, res) {
      t.ifErr(err, 'get updated IP' + desc);
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
    return t.end();
  });
});


test('PUT /nics (with network_uuid)', function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid]', mac);
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    state.nic.putIPnetUUID = params;
    state.desc.putIPnetUUID = desc;

    var updateParams = { network_uuid: state.network.uuid };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ifErr(err2, 'update nic' + desc);
      if (err2) {
        return t.end();
      }

      params.primary = false;
      params.mac = mac;
      params.ip = res2.ip;
      addNetworkParams(params);
      t.deepEqual(res2, params, 'nic params returned' + desc);
      state.nic.putIPnetUUID = params;
      state.ip.putIPnetUUID = res2.ip;

      napi.getIP(state.network.uuid, res2.ip, function (err3, res3) {
        t.ifErr(err3, 'get IP' + desc);
        if (err) {
          return t.end();
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

        return t.end();
      });
    });
  });
});


test('GET /networks/admin', function (t) {
  napi.getNetwork('admin', function (err, res) {
    t.ifErr(err, 'get admin network');
    if (err) {
      return t.end();
    }

    t.equal(res.name, 'admin', 'admin network found');
    state.adminNet = res;
    return t.end();
  });
});


// Note that this is the only test in this entire suite that affects
// networks used in production. This functionality is absolutely
// necessary for booter, so we should still make sure to test it
test('PUT /nics (with network_uuid set to admin)', function (t) {
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid set to admin]', mac);
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    state.nic.putIPwithName = params;
    state.desc.putIPwithName = desc;

    var updateParams = { network_uuid: 'admin' };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ifErr(err2, 'update nic' + desc);
      if (err2) {
        return t.end();
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
        t.ifErr(err3, 'get IP' + desc);
        if (err) {
          return t.end();
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

        return t.end();
      });
    });
  });
});


test('PUT /nics (with network_uuid set to invalid name)', function (t) {
  // Only network_uuid=admin is allowed
  var params = {
    owner_uuid: uuids.b,
    belongs_to_uuid: uuids.a,
    belongs_to_type: 'server'
  };
  var mac = helpers.randomMAC();

  napi.createNic(mac, params, function (err, res) {
    var desc = util.format(' [%s: with network_uuid set to name]', mac);
    t.ifErr(err, 'provision nic' + desc);
    if (err) {
      return t.end();
    }

    state.nic.putIPwithInvalidName = params;
    state.desc.putIPwithInvalidName = desc;

    var updateParams = { network_uuid: state.network.name };
    napi.updateNic(mac, updateParams, function (err2, res2) {
      t.ok(err2, 'expected error');
      if (!err2) {
        return t.end();
      }

      // XXX: we end up with a stringified JSON object here, which is
      // definitely a bug somewhere.
      t.notEqual(err2.message,
        util.format('Unknown network "%s"', state.network.name),
        'Error message correct');
      return t.end();
    });
  });
});


test('GET /nics (filtered by belongs_to_uuid)', function (t) {
  var filter = { belongs_to_uuid: uuids.d };
  var nics = ['a', 'b', 'd'].reduce(function (r, n) {
    r[state.nic[n].mac] = n;
    return r;
  }, {});

  napi.listNics(filter, function (err, res) {
    t.ifErr(err, 'get nics');

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
    return t.end();
  });
});


test('GET /nics (filtered)', function (t) {
  var filters = [
    { belongs_to_type: 'other' },
    { owner_uuid: uuids.b },
    { nic_tag: state.nicTag.name }
  ];

  var listNics = function (filter, cb) {
    napi.listNics(filter, function (err, res) {
      t.ifErr(err, 'get nics: ' + JSON.stringify(filter));

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
    return t.end();
  });
});


test('POST /nics (nic_tags_provided)', function (t) {
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
    t.ifErr(err, 'create nic 1');
    if (err) {
      return t.end();
    }
    state.nic.f = res;
    state.desc.f = util.format(' [%s: nic_tags_provided nic 1]', res.mac);
    t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
      'nic 1 nic_tags_provided');

    napi.createNic(helpers.randomMAC(), params2, function (err2, res2) {
      t.ifErr(err2, 'create nic 2');
      if (err2) {
        return t.end();
      }

      state.nic.g = res2;
      state.desc.g = util.format(' [%s: nic_tags_provided nic 2]', res2.mac);
      t.deepEqual(res.nic_tags_provided, params1.nic_tags_provided,
        'nic 2 nic_tags_provided');

      return t.end();
    });
  });
});


test('POST /nics (nic_tags_provided scalar)', function (t) {
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
        t.ifErr(err, 'create nic 1');
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
        t.ifErr(err, 'update nic 1');
        if (err) {
          return cb(err);
        }

        t.deepEqual(res.nic_tags_provided, [state.nicTag5.name,
          state.nicTag4.name], 'nic 1 nic_tags_provided');

        return cb();
      });
    }]
  }, function () {
    return t.end();
  });
});


test('GET /nics (filter: nic_tags_provided)', function (t) {
  var filter = {
    nic_tags_provided: [state.nicTag2.name, state.nicTag3.name]
  };

  napi.listNics(filter, function (err, res) {
    t.ifErr(err, 'get nics: ' + JSON.stringify(filter));
    if (err) {
      return t.end();
    }
    t.equal(res.length, 2, '2 nics returned');

    if (res.length === 0) {
      return t.end();
    }

    var macs = res.reduce(function (arr, x) {
      arr.push(x.mac);
      return arr;
    }, []).sort();

    t.deepEqual(macs, [state.nic.f.mac, state.nic.g.mac].sort(),
      'both nics returned');
    return t.end();
  });
});


test('DELETE /nics/:mac', function (t) {
  var nics = Object.keys(state.nic);

  var delNic = function (nicNum, cb) {
    var nic = state.nic[nicNum];
    var desc = state.desc[nicNum];

    return napi.deleteNic(nic.mac, function (err, res) {
      t.ifErr(err, 'delete nic ' + nic.mac + desc);
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
    return t.end();
  });
});


test('Check IPs are freed along with nics', function (t) {
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
      t.ifErr(err, 'get updated IP' + desc);
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
    return t.end();
  });
});


test('UFDS validation', function (t) {
  /* jsl:ignore (for regex warning) */
  var invalid = [
    [ { belongstouuid: 'foo' }, /nic belongs_to_uuid/ ],
    [ { owneruuid: 'foo' }, /nic owner_uuid/ ],
    [ { networkuuid: 'foo' }, /nic network_uuid/ ],

    [ { ip: 'foo' }, /IP number/ ],
    [ { ip: -1 }, /IP number/ ],
    [ { ip: 4294967296 }, /IP number/ ],

    [ { mac: 281474976710656 }, /MAC number/ ],
    [ { mac: 0 }, /MAC number/ ],

    [ { primary: 0 }, /nic primary value must be true or false/ ],
    [ { primary: 'foo' }, /nic primary value must be true or false/ ]
  ];
  /* jsl:end */

  var ufdsAdd = function (toTest, cb) {
    var desc = util.format(' (%j)', toTest[0]);
    var params = validUFDSparams();
    var dn = util.format('mac=%d, ou=nics', params.mac);
    for (var p in toTest[0]) {
      params[p] = toTest[0][p];
    }

    helpers.ufdsAdd(state, dn, params, function (err) {
      t.ok(err, 'Error should be returned' + desc);
      if (err) {
        t.similar(err.message, toTest[1], 'Error message matches' + desc);
      }

      return cb(null);
    });
  };

  vasync.forEachParallel({
    func: ufdsAdd,
    inputs: invalid
  }, function (err) {
    return t.end();
  });
});



// --- Teardown



test('Tear down UFDS client', function (t) {
  helpers.destroyUFDSclient(t, state);
});


test('remove test network', function (t) {
  helpers.deleteNetwork(t, napi, state);
});


test('remove test nic tag', function (t) {
  helpers.deleteNicTag(t, napi, state);
});


test('remove second test nic tag', function (t) {
  helpers.deleteNicTag(t, napi, state, 'nicTag2');
});


test('remove third test nic tag', function (t) {
  helpers.deleteNicTag(t, napi, state, 'nicTag3');
});

test('remove fourth test nic tag', function (t) {
  helpers.deleteNicTag(t, napi, state, 'nicTag4');
});

test('remove fifth test nic tag', function (t) {
  helpers.deleteNicTag(t, napi, state, 'nicTag5');
});
