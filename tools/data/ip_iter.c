/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Iterate IPv4 addresses, inclusive.
 */

#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <stdio.h>

int
main(int argc, const char *argv[])
{
	struct in_addr start, end;
	uint32_t first, cur, last;

	if (argc != 3) {
		fprintf(stderr, "ip_iter: <start> <end>\n");
		return (1);
	}

	if (inet_pton(AF_INET, argv[1], &start) != 1) {
		fprintf(stderr, "argv[1] (%s) looks bad\n", argv[1]);
		return (1);
	}

	if (inet_pton(AF_INET, argv[2], &end) != 1) {
		fprintf(stderr, "argv[2] (%s) looks bad\n", argv[2]);
		return (1);
	}

	first = ntohl(start.s_addr);
	last = ntohl(end.s_addr);

	if (first > last) {
		fprintf(stderr, "starting address is larger than ending, "
		    "aborting\n");
		return (1);
	}

	for (cur = first; cur <= last; cur++) {
		struct in_addr i;
		char buf[INET6_ADDRSTRLEN];

		i.s_addr = htonl(cur);
		if (inet_ntop(AF_INET, &i, buf, sizeof (buf)) == NULL) {
			fprintf(stderr, "conversion failed!\n");
			return (1);
		}
		puts(buf);
	}

	return (0);
}
