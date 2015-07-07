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
# Create a lot of fabric vlans
#

if [[ -z "$1" ]]; then
	echo "Tell me how many networks to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting number"
	exit 1
fi

if [[ -z "$3" ]]; then
	echo "Tell me the owner uuid"
	exit 1
fi

if [[ -z "$4" ]]; then
	echo "Tell me the VLAN id"
	exit 1
fi

if [[ -z "$5" ]]; then
	echo "Tell me the starting IP"
	exit 1
fi

cn_subnet=28
cn_count=$1
cn_num=$2
cn_owner=$3
cn_vlan=$4
cn_ip=$5

if ! cd $(dirname $0); then
	echo "Failed to change directories"
	exit 1
fi

./ip_sub $cn_ip $cn_subnet $cn_count | while read ip first last; do
	sdc-napi /fabrics/$cn_owner/vlans/$cn_vlan/networks -d "{
		\"name\": \"bulkfab$cn_num\",
		\"subnet\": \"$ip/$cn_subnet \",
		\"provision_start_ip\": \"$first\",
		\"provision_end_ip\": \"$last\"
	}"
	(( cn_num++ ))
done
