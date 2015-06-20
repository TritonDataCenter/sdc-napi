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
# Create a lot of network pools
#

if [[ -z "$1" ]]; then
	echo "Tell me how many pools to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting pool number"
	exit 1
fi

if [[ -z "$3" ]]; then
	echo "Tell me the network uuid to use for the pool"
	exit
fi

cn_count=$1
cn_num=$2
cn_net=$3

i=0
while ((i < cn_count )); do
	sdc-napi /network_pools -X POST -d "{ 
		\"name\": \"bulkpool$cn_num\",
		\"networks\": [ \"$cn_net\" ]
	}"
	if [[ $? -ne 0 ]]; then
		echo 'failed to create nic tag'
		exit 1
	fi
	((i++))
	((cn_num++))
done
