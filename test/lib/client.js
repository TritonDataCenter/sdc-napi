/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * Test helpers for dealing with the NAPI client
 */

'use strict';


// --- Globals



var CLIENT;



// --- Exports



function getClient() {
    if (!CLIENT) {
        throw new Error('NAPI client not initialized!');
    }

    return CLIENT;
}


function initialized() {
    return CLIENT ? true : false;
}


function setClient(client) {
    CLIENT = client;
}



module.exports = {
    initialized: initialized,
    get: getClient,
    set: setClient
};
