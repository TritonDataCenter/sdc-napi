<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# sdc-napi

This repository is part of the Joyent SmartDataCenter project (SDC).  For
contribution guidelines, issues, and general documentation, visit the main
[SDC](http://github.com/joyent/sdc) project page.

The SDC Networking API (NAPI) manages networking-related data for SDC. This
includes the provisioning of MAC addresses for new Virtual Nics (vnics) and
IP addresses for subnets. For more information on the objects that NAPI
manages, see [docs/index.restdown](https://github.com/joyent/sdc-napi/blob/master/docs/index.restdown).

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
    Makefile
    package.json        npm module info (holds the project version)
    README.md
    server.js           API server main entry point


# Development

To get started:

    git clone git@github.com:joyent/sdc-napi.git
    make

To update the docs, edit "docs/index.restdown", then check that
"docs/index.html" gets updated properly by running:

    make docs

To run style and lint checks:

    make check

To run all checks and tests:

    make prepush

Before commiting/pushing run `make prepush` and, if possible, get a code
review. For non-trivial changes, a unit or integration test that covers the
new behaviour is required.


# Testing

## Unit tests

To run all tests:

    make test

To run an individual test:

    ./test/runtest ./test/unit/testname.test.js

## Integration tests

To run the integration tests, on a **non-production** SDC server:

    sdc-login napi
    /opt/smartdc/napi/test/runtests

Or to run an individual integration test:

    /opt/smartdc/napi/test/runtest /opt/smartdc/napi/test/integration/testname.test.js
