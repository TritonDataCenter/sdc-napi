/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * NAPI /nic_tags endpoints
 */

var restify = require('restify');
var mod_nicTag = require('../models/nic-tag');
var util = require('util');



/*
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


/*
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


/*
 * GET /nic_tags/:name: get a nic tag
 */
function getNicTag(req, res, next) {
  mod_nicTag.get(req.app, req.log, req.params, function (err, tag) {
    if (err) {
      return next(err);
    }

    if (!tag) {
      return next(new restify.ResourceNotFoundError(
        util.format('Unknown nic tag "%s"', req.params.name)));
    }

    res.send(200, tag.serialize());
    return next();
  });
}


/*
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


/*
 * DELETE /nic_tags/:name: delete a nic tag
 */
function deleteNicTag(req, res, next) {
  mod_nicTag.del(req.app, req.log, req.params, function (err, tag) {
    if (err) {
      return next(err);
    }
    res.send(204);
    return next();
  });
}


/*
 * Register all endpoints with the restify server
 */
function register(http, before) {
  http.get({ path: '/nic_tags', name: 'ListNicTags' },
    before, listNicTags);
  http.head({ path: '/nic_tags', name: 'headNicTags' },
    before, listNicTags);
  http.post({ path: '/nic_tags', name: 'postNicTag' },
      before, postNicTag);

  http.get({ path: '/nic_tags/:name', name: 'getNicTag' },
    before, getNicTag);
  http.head({ path: '/nic_tags/:name', name: 'headNic' },
    before, getNicTag);
  http.put({ path: '/nic_tags/:name', name: 'putNicTag' },
      before, putNicTag);
  http.del({ path: '/nic_tags/:name', name: 'deleteNicTag' },
    before, deleteNicTag);
}



module.exports = {
  register: register
};
