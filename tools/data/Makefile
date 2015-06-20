#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2015 Joyent, Inc.
#

#
# Generate bulk data tools
#

CC = gcc
RM = rm -f
CP = cp
CHMOD = chmod
RMDIR = rmdir
LDLIBS = -lnsl
CFLAGS = -Wall -Wextra -Werror
PROTO = proto

CPROGS = \
	ip_iter \
	ip_sub

SPROGS = \
	aggrs.sh \
	fabnets.sh  \
	fabvlans.sh \
	ips.sh \
	nics.sh \
	pools.sh \
	tags.sh \
	users.sh

TARGETS = $(CPROGS:%=$(PROTO)/%) $(SPROGS:%.sh=$(PROTO)/%)

$(PROTO)/%: %.c $(PROTO)
	$(CC) $(CFLAGS) $(LDLIBS) -o $@ $<	

$(PROTO)/%: %.sh $(PROTO)
	$(RM) $@
	$(CP) $< $@
	$(CHMOD) 0555 $@

all: $(TARGETS)
	echo $(TARGETS)

$(PROTO):
	mkdir $@

clobber:
	$(RM) $(TARGETS)
	$(RM) -r $(PROTO)

clean: clobber
