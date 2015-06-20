#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2015, Joyent, Inc.
#

#
# Reserve every IP in a network based on prov range
#

if [[ -z "$1" ]]; then
	echo "Give me a network uuid"
	exit 1
fi

cn_network=$1
cn_net=$(sdc-napi /networks/$cn_network | json -H)
if [[ $? -ne 0 ]]; then
	echo "failed to get network info"
	exit 1
fi

cn_start=$(echo $cn_net | json provision_start_ip)
cn_end=$(echo $cn_net | json provision_end_ip)

./ip_iter $cn_start $cn_end | while read ip; do
	sdc-napi /networks/$cn_network/ips/$ip -X PUT -d "{
		\"reserved\": true
	}"
done
