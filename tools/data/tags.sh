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
# Create a lot of network tags
#

if [[ -z "$1" ]]; then
	echo "Tell me how many nic tags to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting nic tag number"
	exit 1
fi

cn_count=$1
cn_num=$2

i=0
while ((i < cn_count )); do
	sdc-napi /nic_tags -X POST -d "{ 
		\"name\": \"bulk$cn_num\"
	}"
	if [[ $? -ne 0 ]]; then
		echo 'failed to create nic tag'
		exit 1
	fi
	((i++))
	((cn_num++))
done
