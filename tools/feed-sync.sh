#!/bin/sh
# Copy the LuCI app to an openwrt/luci checkout, or check that the two match.
#
# Usage:
#   tools/feed-sync.sh copy  <openwrt-luci-checkout>   replace applications/luci-app-apmond there
#   tools/feed-sync.sh check <openwrt-luci-checkout>   diff only; exit 0 if identical, 1 if not
#
# The app directory in this repository, openwrt/luci-app-apmond/, is copied as it is: it is
# laid out exactly as applications/luci-app-apmond in openwrt/luci (Makefile with luci.mk,
# htdocs/, root/, po/).

APP=luci-app-apmond
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC="$HERE/openwrt/$APP"

usage() {
	echo "usage: $0 copy|check <openwrt-luci-checkout>" >&2
	exit 2
}

[ $# -eq 2 ] || usage
MODE="$1"
LUCI="$2"

if [ ! -f "$LUCI/luci.mk" ] || [ ! -d "$LUCI/applications" ]; then
	echo "$LUCI does not look like an openwrt/luci checkout (no luci.mk or applications/)" >&2
	exit 2
fi
DST="$LUCI/applications/$APP"

case "$MODE" in
copy)
	rm -rf "$DST"
	mkdir -p "$DST"
	cp -a "$SRC/." "$DST/"
	echo "Copied $SRC to $DST"
	;;
check)
	if diff -ru "$SRC" "$DST"; then
		echo "No differences: $DST matches $SRC"
		exit 0
	fi
	exit 1
	;;
*)
	usage
	;;
esac
