# SPDX-License-Identifier: GPL-2.0-only
#
# Copyright (C) 2026 Rob White <rob@blue-wave.net>
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-apmond
PKG_VERSION:=2.0.0_beta
PKG_RELEASE:=1

PKG_MAINTAINER:=Rob White <rob@blue-wave.net>
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=LICENSE

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/openNDS/luci-app-apmond/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=skip

# The source is in the release tarball, not next to this Makefile, so luci.mk (which packages
# the files beside the Makefile) is not used. This does what luci.mk does for this app:
# jsmin from luci-base/host when CONFIG_LUCI_JSMIN is set, and the LuCI cache clear in postinst.
PKG_BUILD_DEPENDS:=luci-base/host
PKG_CONFIG_DEPENDS:=CONFIG_LUCI_JSMIN

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-apmond
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for ApmonD 2.x
  PKGARCH:=all
  DEPENDS:=+luci-base +apmond
  URL:=https://github.com/openNDS/luci-app-apmond
endef

define Package/luci-app-apmond/description
  Settings, status, access points, clients and log for ApmonD 2.x, the access point
  monitoring daemon. Reads apmond over ubus (rpcd); needs apmond 2.0 or later.
endef

define Build/Compile
endef

define Package/luci-app-apmond/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/apmond
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/htdocs/luci-static/resources/view/apmond/*.js $(1)/www/luci-static/resources/view/apmond/
	$(if $(CONFIG_LUCI_JSMIN),$(FIND) $(1)/www -type f -name '*.js' | while read src; do \
		if jsmin < "$$$$src" > "$$$$src.o"; then \
			mv "$$$$src.o" "$$$$src"; \
		else \
			rm -f "$$$$src.o"; \
		fi; \
	done)
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/root/usr/share/luci/menu.d/luci-app-apmond.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/root/usr/share/rpcd/acl.d/luci-app-apmond.json $(1)/usr/share/rpcd/acl.d/
endef

define Package/luci-app-apmond/postinst
[ -n "$${IPKG_INSTROOT}" ] || { \
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload 2>/dev/null
	exit 0
}
endef

$(eval $(call BuildPackage,luci-app-apmond))
