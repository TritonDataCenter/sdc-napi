<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2019 Joyent, Inc.
    Copyright 2024 MNX Cloud, Inc.
-->

# sdc-napi

This repository is part of the Triton Data Center project. See the [contribution
guidelines](https://github.com/TritonDataCenter/triton/blob/master/CONTRIBUTING.md)
and general documentation at the main
[Triton project](https://github.com/TritonDataCenter/triton) page.

The SDC Networking API (NAPI) manages networking-related data for SDC. This
includes the provisioning of MAC addresses for new Virtual Nics (vnics) and
IP addresses for subnets. For more information on the objects that NAPI
manages, see
[docs/index.md](https://github.com/TritonDataCenter/sdc-napi/blob/master/docs/index.md).

The contents of this repo are bundled up into an image that is then provisioned
as the napi zone in SDC.


# Repository

    bin/                CLI tools
    boot/               Shell scripts for booting and configuring the zone
    deps/               Git submodules
    docs/               Project docs (restdown)
    lib/                Source files.
    node_modules/       node.js dependencies - not checked in, but installed
                        with `npm install`
    sapi_manifests/     Service API (SAPI) manifests
    sbin/napid          Executable that runs NAPI
    smf/manifests       SMF manifests
    smf/methods         SMF method scripts
    test/               Test suites (using nodeunit)
        integration/    Integration tests (to be run in a deployed napi zone)
        unit/           Unit tests (to be run in your development environment)
    tools/              Miscellaneous dev tools
    tools/data		Tools to generate bulk data
    Makefile
    package.json        npm module info (holds the project version)
    README.md
    server.js           API server main entry point


# Development

## Getting started

    git clone git@github.com:TritonDataCenter/sdc-napi.git
    make

To update the docs, edit "docs/index.md", then check that
"docs/index.html" gets updated properly by running:

    make docs

To run style and lint checks:

    make check

To run all checks and tests:

    make prepush

Before commiting/pushing run `make prepush` and, if possible, get a code
review. For non-trivial changes, a unit or integration test that covers the
new behaviour is required.


## Code layout

The code in `lib/` has a particular layout - please adhere to this if possible.
The general areas are:

- `apis`: Helper code for accessing other APIs
- `endpoints`: All restify handlers go here
- `models`: Modules that handle persistence of all of the various NAPI objects
- `util`: Utility functions


### models

`models` is where the meat of NAPI lies. Each model can be one file (as per
`models/aggregation.js`), or split into many files in a subdirectory (as per
`models/nic/`. Each model must at minimum, export the following functions:

- create
- del
- get
- init: for initializing moray buckets for the object type
- list
- update

`models/aggregation.js` is a good example of the function signature these
functions should have going forward: `function (opts, callback)`, where `opts`
is an object.


### Sharp edges

Fair warning: NAPI has the unfortunate problem that its various objects have 1:N
relationships, and many of them either have hierarchies or dependencies on other
objects. It works around this by:

- Refusing to delete objects if another depends on them
- Making changes in moray batches if possible: this ensures that changes to
  multiple moray buckets will be atomic.

NAPI also represents pools of objects, whether it's IP space in a subnet, or
MAC addresses. Often a user doesn't care what the value is: they just want the
"next" one. Doing this in a way that works with many API instances is pretty
messy: it depends on both retries and using moray's `.sql()` method. See the
Big Theory Statement at the top of `models/ip/provision.js`, and the code in
`models/nic/provision.js` for the details, and be cautious when changing code
in those areas.


## Coding style

Some style idiosyncracies and other miscellaneous bits that might not seem
obvious at first:

- `module.exports` lives at the bottom of each file, so you always know where
  to look.
- Variable and function declarations are in alphabetical order, if possible.
- Global variables, internal functions and exports are in their own sections
  in each file, and are always in that order.
- `callback` is used for the callback passed into a top-level function. `cb`
  is used for the callbacks passed to `vasync` functions.
- Functions and variable names are camel-cased, except for globals, which are
  all caps with underscores.

Poking around the code a bit should give you a feel for the style. When in
doubt, try to copy the style already in the file you're changing.


# Testing

All checkins **must** be accompanied by either a unit test or an integration
test (or ideally both)! The only exceptions should be either trivial changes
that don't change operational functionality, or dependency updates. Please
ensure all unit and integration tests pass before checkin.


## Running unit tests

The unit tests require having Postgres installed. On Mac OS X and SmartOS, you
can install it with:

    pkgin in postgresql92-server postgresql92-client

To run all of the unit tests:

    make test

This will also output code coverage information into `coverage/`. To run an
individual test:

    ./test/runtest ./test/unit/testname.test.js

To run an individual test with more verbose logging:

    LOG_LEVEL=debug ./test/runtest ./test/unit/testname.test.js


## Running integration tests

To run the integration tests, on a **non-production** SDC server:

    sdc-login napi
    /opt/smartdc/napi/test/runtests

Or to run an individual integration test:

    sdc-login napi
    /opt/smartdc/napi/test/runtest /opt/smartdc/napi/test/integration/testname.test.js

To run the integration tests from a different host:

    NAPI_HOST=10.99.99.10 test/runtests
    NAPI_HOST=10.99.99.10 node test/integration/testname.test.js


## Writing tests

Tests in NAPI have evolved considerably over its lifetime, and the remnants of
those older styles are still lingering.  The current preferred way of writing
tests is to have top-level tests with many smaller sub-tests.  Those sub-tests
should call out to the high-level test helpers in `test/lib`, like in this
example based on `test/unit/aggregations.test.js`:

    test('update', function (t) {
        // ... any setup code goes here ...

        t.test('update name', function (t2) {
            mod_aggr.get(t2, {
                id: 'aggr9',
                expCode: 404,
                expErr: {
                    code: 'ResourceNotFound',
                    message: 'aggregation not found'
                }
            });
        });

        // ... more tests ...

        t.test('update name', function (t2) {
            mod_aggr.update(t2, {
                id: state.aggrs[0].id,
                params: {
                    name: 'aggr9'
                },
                // Should be unchanged
                exp: state.aggrs[0]
            });
        });
    });

In this example, mod_aggr is the test helper.  All of the test helpers in
`test/lib` have similar APIs and all leverage the same shared code to avoid
duplication. This hopefully avoids writing the same boilerplate code over and
over.

Other general test guidelines:

- Use the API to both insert and retrieve data, unless you really need to
  test that the data is being stored in a certain format (to work around a
  limitation in moray, say).
- Check the TODOs in each of the test files as you modify them - you may have
  completed one of them while making your changes (or could easily add one of
  them).

## Bulk Data Generation

There are a series of scripts and C programs in the `tools/data` directory. They
may be used to generate any kind of action necessary. To prepare the tools for
use, run gmake inside of the directory and copy the resulting contents of the
`tools/data/proto` to a directory on a head node.
