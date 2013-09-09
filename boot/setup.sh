#!/usr/bin/bash
# -*- mode: shell-script; fill-column: 80; -*-
#
# Copyright (c) 2013 Joyent Inc., All rights reserved.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

role=napi
app_name=$role
CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/$role

echo "Finishing setup of $role zone"

# Include common utility functions (then run the boilerplate)
source /opt/smartdc/boot/lib/util.sh
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/napi

# Add build/node/bin and node_modules/.bin to PATH
echo "" >>/root/.profile
echo "export PATH=\$PATH:/opt/smartdc/$role/node/bin:/opt/smartdc/$role/node_modules/.bin:/opt/smartdc/$role/bin" >>/root/.profile

echo "Adding log rotation"
logadm -w napi -C 48 -s 100m -p 1h \
   /var/svc/log/smartdc-application-napi:default.log

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
