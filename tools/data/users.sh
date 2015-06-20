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
# Create a lot of users (and thus fabric networks)
#

if [[ -z "$1" ]]; then
	echo "Tell me how many users to create"
	exit 1
fi

if [[ -z "$2" ]]; then
	echo "Tell me the starting number"
	exit 1
fi

cr_count=$1
cr_num=$2

#
# That blank line after the user password is really, really, really, necessary.
# It's the inter-record separator for LDIF (RFC 2849).
#

i=0
while (( i < cr_count )); do
	cr_uuid=$(uuid -v4)
	if [[ $? -ne 0 ]]; then
		echo "failed to get a uuid, sorry."
		exit 1
	fi

	cat <<EOF
dn: uuid=$cr_uuid, ou=users, o=smartdc
approved_for_provisioning: true
cn: sample user $cr_num
company: joyentsample
email: sample$cr_num@example.com
givenname: sample$cr_num
login: sample$cr_num
objectclass: sdcperson
phone: 123-456-7890
registered_developer: false
sn: citizen
uuid: $cr_uuid
userpassword: 12345ismyluggagepassword

EOF

	(( i++ ))
	(( cr_num++ ))
done | sdc-ldap add
