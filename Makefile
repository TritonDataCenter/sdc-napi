#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright 2022 Joyent, Inc.
#

#
# NAPI Makefile
#

NAME = napi

#
# Tools
#

ISTANBUL	:= node_modules/.bin/istanbul
FAUCET		:= node_modules/.bin/faucet

#
# Files
#

RESTDOWN_FLAGS   = --brand-dir=deps/restdown-brand-remora
EXTRA_DOC_DEPS	= deps/restdown-brand-remora/.git
DOC_FILES	 = index.md
JS_FILES	:= $(shell ls *.js) $(shell find lib test -name '*.js') \
	bin/ip2num bin/num2ip bin/mac2num bin/num2mac
ESLINT_FILES   = $(JS_FILES)
JSSTYLE_FILES	= $(JS_FILES)
JSSTYLE_FLAGS	= -o indent=2,doxygen,unparenthesized-return=0,strict-indent=true
ESLINT		= ./node_modules/.bin/eslint
ESLINT_FILES	= $(JS_FILES)
SMF_MANIFESTS_IN = smf/manifests/napi.xml.in
BASH_FILES	:= sbin/napid bin/napictl
JSON_FILES  := package.json config.json.sample

ifeq ($(shell uname -s),SunOS)
	NODE_PREBUILT_IMAGE=a7199134-7e94-11ec-be67-db6f482136c2
	NODE_PREBUILT_VERSION=v6.17.1
	NODE_PREBUILT_TAG=zone64
endif

ENGBLD_USE_BUILDIMAGE	= true
ENGBLD_REQUIRE		:= $(shell git submodule update --init deps/eng)
include ./deps/eng/tools/mk/Makefile.defs
TOP ?= $(error Unable to access eng.git submodule Makefiles.)

BUILD_PLATFORM  = 20210826T002459Z

ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.defs
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.defs
else
	NODE := node
	NPM_EXEC :=
	NPM = npm
endif
include ./deps/eng/tools/mk/Makefile.smf.defs

TOP             := $(shell pwd)
RELEASE_TARBALL := $(NAME)-pkg-$(STAMP).tar.gz
PKGDIR          := $(TOP)/$(BUILD)/pkg
INSTDIR         := $(PKGDIR)/root/opt/smartdc/napi

# our base image is triton-origin-x86_64-21.4.0
BASE_IMAGE_UUID = 502eeef2-8267-489f-b19c-a206906f57ef
BUILDIMAGE_NAME = $(NAME)
BUILDIMAGE_DESC	= SDC NAPI
AGENTS		= amon config registrar

#
# Repo-specific targets
#

.PHONY: all
all: $(SMF_MANIFESTS) | $(NPM_EXEC) sdc-scripts
	$(NPM) install --production

$(ISTANBUL): | $(NPM_EXEC)
	$(NPM) install

$(FAUCET): | $(NPM_EXEC)
	$(NPM) install

CLEAN_FILES += ./node_modules/tape

.PHONY: test
test: $(ISTANBUL) $(FAUCET)
	$(NODE) $(ISTANBUL) cover --print none test/unit/run.js | $(FAUCET)

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
	cp $(TOP)/test/config.json $(INSTDIR)/test/
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
	(cd $(PKGDIR) && $(TAR) -I pigz -cf $(TOP)/$(RELEASE_TARBALL) root site)

.PHONY: publish
publish: release
	mkdir -p $(ENGBLD_BITS_DIR)/napi
	cp $(TOP)/$(RELEASE_TARBALL) $(ENGBLD_BITS_DIR)/napi/$(RELEASE_TARBALL)

#
# Includes
#

include ./deps/eng/tools/mk/Makefile.deps
ifeq ($(shell uname -s),SunOS)
	include ./deps/eng/tools/mk/Makefile.node_prebuilt.targ
	include ./deps/eng/tools/mk/Makefile.agent_prebuilt.targ
endif
include ./deps/eng/tools/mk/Makefile.smf.targ
include ./deps/eng/tools/mk/Makefile.targ

sdc-scripts: deps/sdc-scripts/.git
