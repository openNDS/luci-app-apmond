#
# Copyright (C) 2026 Rob White <rob@blue-wave.net>
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for ApmonD
LUCI_DESCRIPTION:=Settings, status, access point reports and log for ApmonD, the access point monitoring daemon
LUCI_DEPENDS:=+luci-base +apmond
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=2
PKG_LICENSE:=GPL-2.0
PKG_MAINTAINER:=Rob White <rob@blue-wave.net>

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
