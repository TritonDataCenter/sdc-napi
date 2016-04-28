/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * NAPI /nic_tags endpoints
 */

'use strict';

var mod_nicTag = require('../models/nic-tag');
var restify = require('restify');



// --- Restify handlers



/**
 * GET /nic_tags: get the list of nic tags
 */
function listNicTags(req, res, next) {
    mod_nicTag.list(req.app, req.log, req.params, function (err, tags) {
        if (err) {
            return next(err);
        }

        var serialized = [];
        for (var t in tags) {
            serialized.push(tags[t].serialize());
        }

        res.send(200, serialized);
        return next();
    });
}


/**
 * POST /nic_tags: create a nic tag
 */
function postNicTag(req, res, next) {
    mod_nicTag.create(req.app, req.log, req.params, function (err, tag) {
        if (err) {
            return next(err);
        }

        res.send(200, tag.serialize());
        return next();
    });
}


/**
 * GET /nic_tags/:name: get a nic tag
 */
function getNicTag(req, res, next) {
    mod_nicTag.get(req.app, req.log, req.params, function (err, tag) {
        if (err) {
            return next(err);
        }

        if (!tag) {
            return next(new restify.ResourceNotFoundError('nic tag not found'));
        }

        res.send(200, tag.serialize());
        return next();
    });
}


/**
 * PUT /nic_tags/:name: update a nic tag
 */
function putNicTag(req, res, next) {
    mod_nicTag.update(req.app, req.log, req.params, function (err, tag) {
        if (err) {
            return next(err);
        }

        res.send(200, tag.serialize());
        return next();
    });
}


/**
 * DELETE /nic_tags/:name: delete a nic tag
 */
function deleteNicTag(req, res, next) {
    mod_nicTag.del(req.app, req.log, req.params, function (err) {
        if (err) {
            return next(err);
        }
        res.send(204);
        return next();
    });
}


/**
 * Register all endpoints with the restify server
 */
function register(http, before) {
    http.get({ path: '/nic_tags', name: 'ListNicTags' },
        before, listNicTags);
    http.head({ path: '/nic_tags', name: 'HeadNicTags' },
        before, listNicTags);
    http.post({ path: '/nic_tags', name: 'CreateNicTag' },
        before, postNicTag);

    http.get({ path: '/nic_tags/:name', name: 'GetNicTag' },
        before, getNicTag);
    http.head({ path: '/nic_tags/:name', name: 'headNicTag' },
        before, getNicTag);
    http.put({ path: '/nic_tags/:oldname', name: 'UpdateNicTag' },
        before, putNicTag);
    http.del({ path: '/nic_tags/:name', name: 'DeleteNicTag' },
        before, deleteNicTag);
}



module.exports = {
    register: register
};
