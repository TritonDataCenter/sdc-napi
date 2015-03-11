#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

#
# NAPI Makefile
#

#
# Tools
#

TAPE	:= ./node_modules/.bin/tape

#
# Files
#

RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS	= deps/restdown-brand-remora/.git
DOC_FILES	 = index.md
JS_FILES	:= $(shell ls *.js) $(shell find lib test -name '*.js') \
	bin/ip2num bin/num2ip bin/mac2num bin/num2mac
JSL_CONF_NODE	 = tools/jsl.node.conf
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSSTYLE_FLAGS    = -o indent=4,doxygen,unparenthesized-return=0
SMF_MANIFESTS_IN = smf/manifests/napi.xml.in
BASH_FILES	:= sbin/napid bin/napictl
JSON_FILES  := package.json config.json.sample

ifeq ($(shell uname -s),SunOS)
	# Allow building on a SmartOS image other than sdc-smartos/1.6.3.
	NODE_PREBUILT_IMAGE=fd2cc906-8938-11e3-beab-4359c665ac99
	NODE_PREBUILT_VERSION=v0.10.37
	NODE_PREBUILT_TAG := zone
endif

include ./tools/mk/Makefile.defs
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.defs
else
	NPM_EXEC :=
	NPM = npm
endif
include ./tools/mk/Makefile.smf.defs

TOP             := $(shell pwd)
RELEASE_TARBALL := napi-pkg-$(STAMP).tar.bz2
PKGDIR          := $(TOP)/$(BUILD)/pkg
INSTDIR         := $(PKGDIR)/root/opt/smartdc/napi

#
# Repo-specific targets
#

.PHONY: all
all: $(SMF_MANIFESTS) | $(TAPE) $(REPO_DEPS) sdc-scripts
	$(NPM) install

$(TAPE): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += $(TAPE) ./node_modules/tape

.PHONY: test
test: $(TAPE)
	@(for F in test/unit/*.test.js; do \
		echo "# $$F" ;\
		$(NODE_EXEC) $(TAPE) $$F ;\
		[[ $$? == "0" ]] || exit 1; \
	done)

#
# Packaging targets
#

.PHONY: release
release: $(RELEASE_TARBALL)

.PHONY: pkg
pkg: all $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@rm -rf $(PKGDIR)
	@mkdir -p $(PKGDIR)/site
	@mkdir -p $(INSTDIR)/smf/manifests
	@mkdir -p $(INSTDIR)/test/integration
	@mkdir $(INSTDIR)/test/lib
	@touch $(PKGDIR)/site/.do-not-delete-me
	cp -r $(TOP)/server.js \
		$(TOP)/bin \
		$(TOP)/lib \
		$(TOP)/node_modules \
		$(TOP)/package.json \
		$(TOP)/sapi_manifests \
		$(TOP)/sbin \
		$(INSTDIR)/
	cp smf/manifests/*.xml $(INSTDIR)/smf/manifests
	cp $(TOP)/test/runtest $(INSTDIR)/test/
	cp $(TOP)/test/runtests $(INSTDIR)/test/
	cp -r $(TOP)/test/integration/* $(INSTDIR)/test/integration/
	cp -r $(TOP)/test/lib/* $(INSTDIR)/test/lib/
	cp -PR $(NODE_INSTALL) $(INSTDIR)/node
	mkdir -p $(PKGDIR)/root/opt/smartdc/boot
	cp -R $(TOP)/deps/sdc-scripts/* $(PKGDIR)/root/opt/smartdc/boot/
	cp -R $(TOP)/boot/* $(PKGDIR)/root/opt/smartdc/boot/
	# Clean up some dev / build bits
	find $(INSTDIR) -name "*.pyc" | xargs rm -f
	find $(INSTDIR) -name "*.o" | xargs rm -f
	find $(INSTDIR) -name c4che | xargs rm -rf   # waf build file
	find $(INSTDIR) -name .wafpickle* | xargs rm -rf   # waf build file
	find $(INSTDIR) -name .lock-wscript | xargs rm -rf   # waf build file
	find $(INSTDIR) -name config.log | xargs rm -rf   # waf build file

$(RELEASE_TARBALL): pkg
	(cd $(PKGDIR) && $(TAR) -jcf $(TOP)/$(RELEASE_TARBALL) root site)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
    echo "error: 'BITS_DIR' must be set for 'publish' target"; \
    exit 1; \
  fi
	mkdir -p $(BITS_DIR)/napi
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/napi/$(RELEASE_TARBALL)

#
# Includes
#

include ./tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./tools/mk/Makefile.node_prebuilt.targ
endif
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
