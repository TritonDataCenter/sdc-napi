/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2018, Joyent, Inc.
 */

/*
 * NAPI /fabrics/:owner_uuid/vlans endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_common = require('./common');
var mod_fabric = require('../../models/fabric');
var mod_vlan = require('../../models/vlan');
var reqToOpts = require('../../util/common').reqToOpts;
var restify = require('restify');



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


function ensureVlanExists(req, res, next) {
    mod_vlan.get(reqToOpts(req), function (err, vlan) {
        if (err) {
            next(err);
            return;
        }

        req._vlan = vlan;
        res.etag = vlan.etag;

        next();
    });
}


// --- Endpoints



/**
 * POST /fabrics/:owner_uuid/vlans: create a fabric VLAN
 */
function createFabricVLAN(req, res, next) {
    mod_vlan.create(reqToOpts(req, {
        fabric: req._fabric
    }), function (err, vlan) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', vlan.etag);
        res.send(200, vlan.serialize());

        next();
    });
}



/**
 * DELETE /fabrics/:owner_uuid/vlans/:vlan_id: delete a fabric VLAN
 */
function delFabricVLAN(req, res, next) {
    mod_vlan.del(reqToOpts(req), function (err) {
        if (err) {
            next(err);
            return;
        }

        res.send(204);
        next();
    });
}



/**
 * GET /fabrics/:owner_uuid/vlans/:vlan_id: get a fabric VLAN
 */
function getFabricVLAN(req, res, next) {
    assert.object(req._vlan, 'req._vlan');
    res.header('Etag', req._vlan.etag);
    res.send(200, req._vlan.serialize());
    next();
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
 * PUT /fabrics/:owner_uuid/vlans/:vlan_id: update a fabric VLAN
 */
function updateFabricVLAN(req, res, next) {
    assert.object(req._vlan, 'req._vlan');

    mod_vlan.update(reqToOpts(req, {
        existingVlan: req._vlan
    }), function (err, vlan) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', vlan.etag);
        res.send(200, vlan.serialize());

        next();
    });
}



/**
 * Register all endpoints with the restify server
 */
function register(http, serverBefore) {
    var before = serverBefore.concat([
        mod_common.ensureOverlaysEnabled
    ]);
    var vlanRequired = before.concat([
        ensureVlanExists,
        restify.conditionalRequest()
    ]);
    var path = '/fabrics/:owner_uuid/vlans';
    var perObjPath = path + '/:vlan_id';

    http.del({ path: perObjPath, name: 'delFabricVLAN' },
        before, delFabricVLAN);
    http.get({ path: path, name: 'listFabricVLANs' },
        before, listFabricVLANs);
    http.post({ path: path, name: 'createFabricVLAN' },
        before.concat(getFabric), createFabricVLAN);

    http.get({ path: perObjPath, name: 'getFabricVLAN' },
        vlanRequired, getFabricVLAN);
    http.put({ path: perObjPath, name: 'updateFabricVLAN' },
        vlanRequired, updateFabricVLAN);
}



module.exports = {
    register: register
};
