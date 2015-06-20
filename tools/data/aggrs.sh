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
# Create a lot of aggregations
#

if [[ -z "$1" ]]; then
	echo "Tell me how many aggrs to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting aggr number"
	exit 1
fi

if [[ -z "$3" ]]; then
	echo "Tell me the first MAC"
	exit 1
fi

if [[ -z "$4" ]]; then
	echo "Tell me the second MAC"
	exit 1
fi

cn_count=$1
cn_num=$2
cn_mac0=$3
cn_mac1=$4

i=0
while (( i < cn_count )); do
	sdc-napi /aggregations -X POST -d "{
		\"name\": \"bulkaggr$cn_num\",
		\"macs\": [ \"$cn_mac0\", \"$cn_mac1\" ]
	}"
	if [[ $? -ne 0 ]]; then
		echo 'failed to create nic tag'
		exit 1
	fi
	(( i++ ))
	(( cn_num++ ))
done
