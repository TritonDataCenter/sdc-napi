/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2015, Joyent, Inc.
 */

/*
 * Count subnets
 */

#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <stdlib.h>
#include <stdio.h>

int
main(int argc, const char *argv[])
{
	struct in_addr base;
	int bits, count, i, subnet;
	if (argc != 4) {
		fprintf(stderr, "ip_sub: <starting ip> <bits> <count\n>");
		return (1);
	}
	if (inet_pton(AF_INET, argv[1], &base) != 1) {
		fprintf(stderr, "argv[1] (%s) looks bad\n", argv[1]);
		return (1);
	}

	bits = atoi(argv[2]);

	if (bits < 8 || bits >= 32) {
		fprintf(stderr, "bad subnet size, only [8, 32) valid\n");
		return (1);
	}
	count = atoi(argv[3]);

	subnet = ntohl(base.s_addr);
	if ((subnet & (1 << (32 - bits))) != 0) {
		fprintf(stderr, "address doesn't match subnet\n");
		return (1);
	}

	for (i = 0; i < count; i++, subnet += 1 << (32 - bits)) {
		struct in_addr addr;
		char buf[INET_ADDRSTRLEN];
		char first[INET_ADDRSTRLEN];
		char last[INET_ADDRSTRLEN];

		/* addr.s_addr = htonl(subnet); */
		addr.s_addr = htonl(subnet);
		if (inet_ntop(AF_INET, &addr, buf, sizeof (buf)) == NULL) {
			fprintf(stderr, "conversion failed!\n");
			return (1);
		}

		addr.s_addr = htonl(subnet + 1);
		if (inet_ntop(AF_INET, &addr, first, sizeof (first)) == NULL) {
			fprintf(stderr, "conversion failed!\n");
			return (1);
		}

		addr.s_addr = htonl(subnet + 2);
		if (inet_ntop(AF_INET, &addr, last, sizeof (last)) == NULL) {
			fprintf(stderr, "conversion failed!\n");
			return (1);
		}

		printf("%s %s %s\n", buf, first, last);
	}

	return (0);
}
