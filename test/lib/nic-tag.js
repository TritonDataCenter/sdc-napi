/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with nic tags
 */

var common = require('./common');
var log = require('./log');



// --- Globals



var NAPI;



// --- Internal



function initState(state) {
    if (!state.hasOwnProperty('nics')) {
        state.nics = [];
    }

    if (!state.hasOwnProperty('nic_tags')) {
        state.nic_tags = [];
    }
}



// --- Exports



/**
 * Create a nic tag
 */
function create(t, state, name, callback) {
    initState(state);

    log.debug({ name: name }, 'creating nic tag');
    NAPI.createNicTag(name, function (err, res) {
        common.ifErr(t, err, 'create nic tag ' + name);
        if (res) {
            state.nic_tags.push(res);
        }

        if (callback) {
            return callback(err, res);
        } else {
            return t.done();
        }
    });
}



module.exports = {
    get client() {
        return NAPI;
    },
    set client(obj) {
        NAPI = obj;
    },

    create: create
};
