/*
 * Copyright (c) 2014, Joyent, Inc. All rights reserved.
 *
 * Test helpers for dealing with the NAPI client
 */



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
