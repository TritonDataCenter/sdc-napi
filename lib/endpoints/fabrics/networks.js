/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /fabrics/:owner_uuid/vlans/:vlan_id/networks endpoints
 */

'use strict';

var assert = require('assert-plus');
var constants = require('../../util/constants');
var mod_common = require('./common');
var mod_fabric_net = require('../../models/network');
var mod_jsprim = require('jsprim');
var mod_restify = require('restify');
var mod_vlan = require('../../models/vlan');



// --- Internal



/**
 * Return the options object for passing to the mod_fabric_net functions.
 */
function reqOpts(req, extra) {
    return mod_jsprim.mergeObjects({
        app: req.app,
        log: req.log,
        fabric: true,
        owner_uuid: req.params.owner_uuid,
        params: req.params
    }, extra);
}


/**
 * Ensure that the VLAN exists - if it does, stash it in req._vlan
 */
function getParentVLAN(req, res, next) {
    var opts = reqOpts(req);
    opts.checkFields = false;

    mod_vlan.get(opts, function (err, vlan) {
        if (err) {
            return next(err);
        }

        req._vlan = vlan;
        return next();
    });
}


/**
 * Ensures the network exists, and also takes care of performing ownership
 * checks.
 */
function ensureFabricNetworkExists(req, res, next) {
    mod_fabric_net.get(reqOpts(req), function (err, net) {
        if (err) {
            if (err.name === 'InvalidParamsError') {
                next(new mod_restify.ResourceNotFoundError(err,
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


// --- Endpoints



/**
 * DELETE /fabrics/:owner_uuid/vlans/:vlan_id/networks/:uuid - delete a
 * fabric network
 */
function delFabricNetwork(req, res, next) {
    mod_fabric_net.del(reqOpts(req, {
        existingNet: req._network
    }), function (err) {
        if (err) {
            return next(err);
        }

        res.send(204);
        return next();
    });
}



/**
 * POST /fabrics/:owner_uuid/vlans: create a fabric Network
 */
function createFabricNetwork(req, res, next) {
    req.params.fabric = true;
    // XXX: allow overriding this?
    req.params.mtu = constants.OVERLAY_MTU;
    req.params.nic_tag = constants.OVERLAY_TAG;
    req.params.vnet_id = req._vlan.vnet_id;

    // XXX: move this logic into the network model (I guess?)
    if (req.params.owner_uuid) {
        req.params.owner_uuids = [ req.params.owner_uuid ];
    }

    mod_fabric_net.create(reqOpts(req), function (err, net) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', net.etag);
        res.send(200, net.serialize({ fabric: true }));

        next();
    });
}



/**
 * GET /fabrics/:owner_uuid/vlans/:vlan_id/networks/:uuid - get a fabric network
 */
function getFabricNetwork(req, res, next) {
    assert.object(req._network, 'req._network');
    res.header('Etag', req._network.etag);
    res.send(200, req._network.serialize({ fabric: true }));
    next();
}



/**
 * GET /fabrics/:owner_uuid/vlans/:vlan_id/networks - list fabric networks
 */
function listFabricNetworks(req, res, next) {
    req.params.fabric = true;

    mod_fabric_net.list(reqOpts(req), function (err, nets) {
        if (err) {
            return next(err);
        }

        res.send(200, nets.map(function (net) {
            return net.serialize({ fabric: true });
        }));
        return next();
    });
}



/**
 * PUT /fabrics/:owner_uuid/vlans/:vlan_id/networks/:uuid - update a
 * fabric Network
 */
function updateFabricNetwork(req, res, next) { // eslint-disable-line
    req.params.fabric = true;

    mod_fabric_net.update(req, function (err, net) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', net.etag);
        res.send(200, net.serialize({ fabric: true }));

        next();
    });
}



/**
 * Register all endpoints with the restify server
 */
function register(http, serverBefore) {
    var before = serverBefore.concat([
        mod_common.ensureOverlaysEnabled,
        getParentVLAN
    ]);
    var fabricNetRequired = before.concat([
        ensureFabricNetworkExists,
        mod_restify.conditionalRequest()
    ]);
    var path = '/fabrics/:owner_uuid/vlans/:vlan_id/networks';
    var perObjPath = path + '/:uuid';

    http.post({ path: path, name: 'createFabricNetwork' },
        before, createFabricNetwork);
    http.get({ path: path, name: 'listFabricNetworks' }, before,
        listFabricNetworks);

    http.get({ path: perObjPath, name: 'getFabricNetwork' },
        fabricNetRequired, getFabricNetwork);
    http.del({ path: perObjPath, name: 'delFabricNetwork' },
        fabricNetRequired, delFabricNetwork);

    http.put({ path: perObjPath, name: 'updateFabricNetwork' },
       fabricNetRequired, updateFabricNetwork);
}



module.exports = {
    register: register
};
