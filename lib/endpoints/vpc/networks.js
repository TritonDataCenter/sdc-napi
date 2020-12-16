/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * NAPI /vpc/:vpc_uuid/networks endpoints
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../../util/constants');

var mod_common = require('../fabrics/common');
var mod_fabric = require('../../models/fabric');
var mod_vpc_net = require('../../models/network');
var mod_jsprim = require('jsprim');
var mod_restify = require('restify');

function reqOpts(req, extra) {
    return mod_jsprim.mergeObjects({
        app: req.app,
        log: req.log,
        vpc: true,
        vpc_uuid: req.params.vpc_uuid,
        params: req.params
    }, extra);
}

/**
 * Ensure that the VPC exists -- if it does, stash it in req._vpc
 */
function getVPC(req, res, next) {
    var opts = reqOpts(req);
    opts.checkFields = false;

    mod_fabric.getVPC(opts, function getVPCcb(err, vpc) {
        if (err) {
            next(err);
            return;
        }

        req._vpc = vpc;
        next();
        return;
    });
}

function ensureVPCNetworkExists(req, res, next) {
    mod_vpc_net.get(reqOpts(req), function netCb(err, net) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                next(new mod_restify.ResourceNotFounderror(err,
                    'network not found'));
                return;
            }
            next(err);
            return;
        }

        req.params.network = net;
        req._network = net;
        res.etag = net.etag;

        next();
    });
}

/**
 * DELETE /vpc/:vpc_uuid/networks/:uuid - delete a VPC network
 */
function delVPCNetwork(req, res, next) {
    mod_vpc_net.del(reqOpts(req, {
        existingNet: req._network
    }), function delCb(err) {
        if (err) {
            next(err);
            return;
        }

        res.send(204);
        next();
        return;
    });
}

/**
 * POST /vpc/:vpc_uuid/networks: create a VPC Network
 */
function createVPCNetwork(req, res, next) {
    req.params.vpc = true;
    req.params.mtu = constants.OVERLAY_MTU;
    req.params.nic_tag = constants.OVERLAY_TAG;
    req.params.vnet_id = req._vpc.vnet_id;

    if (req.params.owner_uuid) {
        req.params.owner_uuids = [ req.params.owner_uuid ];
    }

    mod_vpc_net.create(reqOpts(req), function createCb(err, net) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', net.etag);
        res.send(200, net.serialize({ vpc: true }));

        next();
    });
}

/**
 * GET /vpc/:vpc_uuid/networks/:uuid - get a VPC network
 */
function getVPCNetwork(req, res, next) {
    assert.object(req._network, 'req._network');
    res.header('Etag', req._network.etag);
    res.send(200, req._network.serialize({ vpc: true }));
    next();
}

/**
 * GET /vpc/:vpc_uuid/networks/:uuid list VPC networks
 */
function listVPCNetworks(req, res, next) {
    req.params.vpc = true;

    mod_vpc_net.list(reqOpts(req), function listCb(err, nets) {
        if (err) {
            next(err);
            return;
        }

        res.send(200, nets.map(function mapCb(net) {
            return net.serialize({ vpc: true });
        }));
        next();
        return;
    });
}

/**
 * PUT /vpc/:vpc_uuid/networks/:uuid - update a VPC network
 */
function updateVPCNetwork(req, res, next) {
    req.params.vpc = true;

    mod_vpc_net.update(reqOpts(req), function updateCb(err, net) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', net.etag);
        res.send(200, net.serialize({ vpc: true }));

        next();
    });
}

function register(http, serverBefore) {
    var before = serverBefore.concat([
        mod_common.ensureOverlaysEnabled,
        getVPC
    ]);
    var vpcNetRequired = before.concat([
        ensureVPCNetworkExists,
        mod_restify.conditionalRequest()
    ]);
    var path = '/vpc/:vpc_uuid/networks';
    var perObjPath = path + '/:uuid';

    http.post({ path: path, name: 'createvpcnetwork' },
        before, createVPCNetwork);
    http.get({ path: path, name: 'listvpcnetworks' }, before,
        listVPCNetworks);

    http.get({ path: perObjPath, name: 'getvpcnetwork' },
        vpcNetRequired, getVPCNetwork);
    http.del({ path: perObjPath, name: 'delvpcnetwork' },
        vpcNetRequired, delVPCNetwork);

    http.put({ path: perObjPath, name: 'updatevpcnetwork' },
        vpcNetRequired, updateVPCNetwork);
}

module.exports = {
    register: register
};
