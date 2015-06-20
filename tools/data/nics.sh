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
# Create a lot of nics
#

if [[ -z "$1" ]]; then
	echo "Tell me how many nics to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Give me a starting number (single value, not MAC)"
	exit 1
fi

if [[ $1 -gt 65536 ]]; then
	echo "Too many macs, sorry."
	exit 1
fi

if [[ -z "$3" ]]; then
	echo "Give me a CN UUID"
	exit 1
fi

if [[ -z "$4" ]]; then
	echo "Give me an owner UUID"
	exit 1
fi

cn_count=$1
cn_num=$2
cn_server=$3
cn_owner=$4

#
# For mac addresses, we start with the OUI 00:00:00. Stealing Xerox's original
# one most likely isn't used too much and using ours will be kind of annoying.
#
cn_macbase="00:00:00:00"

i=0
while ((i < cn_count )); do
	cn_mac5=$(printf %02x $(( $cn_num / 256 )))
	cn_mac6=$(printf %02x $(( $cn_num % 256 )))
	sdc-napi /nics -X POST -d "{ 
		\"owner_uuid\": \"$cn_owner\",
		\"belongs_to_uuid\": \"$cn_server\",
		\"belongs_to_type\": \"server\",
		\"mac\": \"$cn_macbase:$cn_mac5:$cn_mac6\"
	}"
	echo \"mac\": \"$cn_macbase:$cn_mac5:$cn_mac6\"
	if [[ $? -ne 0 ]]; then
		echo 'failed to create nic tag'
		exit 1
	fi
	((i++))
	((cn_num++))
done
