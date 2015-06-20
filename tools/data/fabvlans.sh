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
	echo "Tell me how many vlans to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting vlan id"
	exit 1
fi

if [[ -z "$3" ]]; then
	echo "Tell me the owner uuid"
	exit 1
fi

cn_count=$1
cn_num=$2
cn_owner=$3

i=0
while ((i < cn_count )); do
	sdc-napi /fabrics/$cn_owner/vlans -X POST -d "{ 
		\"name\": \"vlan$cn_num\",
		\"vlan_id\": $cn_num
	}"
	if [[ $? -ne 0 ]]; then
		echo 'failed to create nic tag'
		exit 1
	fi
	((i++))
	((cn_num++))
done
