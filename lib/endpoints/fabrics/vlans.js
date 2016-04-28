/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI /fabrics/:owner_uuid/vlans endpoints
 */

'use strict';

var mod_common = require('./common');
var mod_fabric = require('../../models/fabric');
var mod_vlan = require('../../models/vlan');



// --- Internal



/**
 * Get the fabric object if it exists and store it in req._fabric
 */
function getFabric(req, res, next) {
    mod_fabric.get({
        app: req.app,
        log: req.log,
        params: req.params
    }, function (err, fabric) {
        if (err && err.name !== 'ResourceNotFoundError') {
            return next(err);
        }

        req._fabric = fabric;
        return next();
    });
}



// --- Endpoints



/**
 * POST /fabrics/:owner_uuid/vlans: create a fabric VLAN
 */
function createFabricVLAN(req, res, next) {
    mod_vlan.create({
        app: req.app,
        fabric: req._fabric,
        log: req.log,
        params: req.params
    }, function (err, vlan) {
        if (err) {
            return next(err);
        }

        res.send(200, vlan.serialize());
        return next();
    });
}



/**
 * DELETE /fabrics/:owner_uuid/vlans/:vlan_id: delete a fabric VLAN
 */
function delFabricVLAN(req, res, next) {
    mod_vlan.del({
        app: req.app,
        log: req.log,
        params: req.params
    }, function (err) {
        if (err) {
            return next(err);
        }

        res.send(204);
        return next();
    });
}



/**
 * GET /fabrics/:owner_uuid/vlans/:vlan_id: get a fabric VLAN
 */
function getFabricVLAN(req, res, next) {
    mod_vlan.get({
        app: req.app,
        log: req.log,
        params: req.params
    }, function (err, vlan) {
        if (err) {
            return next(err);
        }

        res.send(200, vlan.serialize());
        return next();
    });
}



/**
 * GET /fabrics/:owner_uuid/vlans - list fabric VLANs
 */
function listFabricVLANs(req, res, next) {
    mod_vlan.list({
        app: req.app,
        log: req.log,
        params: req.params
    }, function (err, vlans) {
        if (err) {
            return next(err);
        }

        res.send(200, vlans.map(function (vlan) {
            return vlan.serialize();
        }));
        return next();
    });
}



/**
 * DELETE /fabrics/:owner_uuid/vlans/:vlan_id: delete a fabric VLAN
 */
function updateFabricVLAN(req, res, next) {
    mod_vlan.update({
        app: req.app,
        log: req.log,
        params: req.params
    }, function (err, vlan) {
        if (err) {
            return next(err);
        }

        res.send(200, vlan.serialize());
        return next();
    });
}



/**
 * Register all endpoints with the restify server
 */
function register(http, serverBefore) {
    var before = serverBefore.concat([
        mod_common.ensureOverlaysEnabled
    ]);
    var path = '/fabrics/:owner_uuid/vlans';
    var perObjPath = path + '/:vlan_id';

    http.del({ path: perObjPath, name: 'delFabricVLAN' },
        before, delFabricVLAN);
    http.get({ path: path, name: 'listFabricVLANs' }, before, listFabricVLANs);
    http.get({ path: perObjPath, name: 'getFabricVLAN' },
        before, getFabricVLAN);
    http.post({ path: path, name: 'createFabricVLAN' },
        before.concat(getFabric), createFabricVLAN);
    http.put({ path: perObjPath, name: 'updateFabricVLAN' },
        before, updateFabricVLAN);
}



module.exports = {
    register: register
};
