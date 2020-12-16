/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021 Joyent, Inc.
 */

/*
 * NAPI /vpc endpoints
 */

'use strict';

var assert = require('assert-plus');
var mod_common = require('../fabrics/common');
var mod_fabric = require('../../models/fabric');
var reqToOpts = require('../../util/common').reqToOpts;
var restify = require('restify');



// --- Internal

/**
 * Get the VPC object if it exists and store it in req._vpc
 */
function ensureVPCExists(req, res, next) {
    mod_fabric.getVPC({
        app: req.app,
        log: req.log,
        params: req.params
    }, function getVpcCb(err, vpc) {
        if (err && err.name !== 'ResourceNotFoundError') {
            next(err);
            return;
        }

        req._vpc = vpc;
        next();
        return;
    });
}

// --- Endpoints

/**
 * POST /vpc: create a VPC
 */
function createVPC(req, res, next) {
    mod_fabric.createVPC(reqToOpts(req), function createCb(err, vpc) {
        if (err) {
            next(err);
            return;
        }

        res.header('Etag', vpc.etag);
        res.send(200, vpc.serialize());

        next();
    });
}

/**
 * DELETE /vpc/:vpc_uuid: Delete a VPC
 */
function delVPC(req, res, next) {
    mod_fabric.deleteVPC(reqToOpts(req), function delCb(err) {
        if (err) {
            next(err);
            return;
        }

        res.send(204);
        next();
    });
}

/**
 * GET /vpc/:vpc_uuid: get a VPC
 */
function getVPC(req, res, next) {
    assert.object(req._vpc, 'req._vpc');
    res.header('Etag', req._vpc.etag);
    res.send(200, req._vpc.serialize());
    next();
}

/**
 * GET /vpc/:vpc_uuid - list VPCs
 */
function listVPCs(req, res, next) {
    mod_fabric.listVPC({
        app: req.app,
        log: req.log,
        params: req.params
    }, function listVPCcb(err, vpcs) {
        if (err) {
            next(err);
            return;
        }

        res.send(200, vpcs.map(function mapVPC(vpc) {
            return vpc.serialize();
        }));

        next();
        return;
    });
}

/**
 * Register all endpoints with the restify server
 */
function register(http, serverBefore) {
    var before = serverBefore.concat([
        mod_common.ensureOverlaysEnabled
    ]);
    var vpcRequired = before.concat([
        ensureVPCExists,
        restify.conditionalRequest()
    ]);
    var path = '/vpc';
    var perObjPath = path + '/:vpc_uuid';

    http.del({ path: perObjPath, name: 'deletevpc' },
        before, delVPC);
    http.get({ path: path, name: 'listvpc' },
        before, listVPCs);
    http.post({ path: path, name: 'createvpc' },
        before, createVPC);

    http.get({ path: perObjPath, name: 'getvpc' },
        vpcRequired, getVPC);
    /*
     * don't allow updates for now
     */
    // http.put({ path: perObjPath, name: 'updatevpc' },
    //     vpcRequired, updateVPC);
}



module.exports = {
    register: register
};
