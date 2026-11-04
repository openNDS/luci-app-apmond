#!/bin/sh
# Copy the LuCI app to an openwrt/luci checkout, or check that the two match.
#
# Usage:
#   tools/feed-sync.sh copy  <openwrt-luci-checkout>   replace applications/luci-app-apmond there
#   tools/feed-sync.sh check <openwrt-luci-checkout>   diff only; exit 0 if identical, 1 if not
#   tools/feed-sync.sh build-beta <sdk-dir> [version] [release]
#       build this checkout in an OpenWrt SDK (or build tree) with the luci feed installed:
#       copies the app directory to <sdk-dir>/feeds/luci/applications/luci-app-apmond,
#       refreshes the luci feed index, installs and builds the package, and prints the apk.
#       version: PKG_VERSION for the apk; default X.Y.Z_beta from a branch named X.Y.Zbeta,
#       otherwise the Makefile's PKG_VERSION. release: PKG_RELEASE, default the Makefile's.
#       Only the SDK copy of the Makefile gets the version; this checkout is not changed.
#
# The app directory in this repository, openwrt/luci-app-apmond/, is copied as it is: it is
# laid out exactly as applications/luci-app-apmond in openwrt/luci (Makefile with luci.mk,
# htdocs/, root/, po/).

APP=luci-app-apmond
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC="$HERE/openwrt/$APP"

usage() {
	echo "usage: $0 copy|check <openwrt-luci-checkout> | build-beta <sdk-dir> [version] [release]" >&2
	exit 2
}

[ $# -ge 2 ] || usage
MODE="$1"

if [ "$MODE" = "build-beta" ]; then
	SDK=$(cd "$2" 2>/dev/null && pwd)
	if [ -z "$SDK" ] || [ ! -x "$SDK/scripts/feeds" ] || [ ! -f "$SDK/feeds/luci/luci.mk" ]; then
		echo "$2 is not an SDK or build tree with the luci feed (feeds/luci/luci.mk)" >&2
		exit 2
	fi

	VER="$3"
	REL="$4"
	if [ -z "$VER" ]; then
		branch=$(git -C "$HERE" rev-parse --abbrev-ref HEAD 2>/dev/null)
		case "$branch" in
		*beta)
			VER="${branch%beta}_beta"
			;;
		esac
	fi

	"$0" copy "$SDK/feeds/luci" || exit 1
	cd "$SDK" || exit 1
	./scripts/feeds update -i luci >/dev/null 2>&1 || exit 1
	./scripts/feeds install -p luci "$APP" >/dev/null 2>&1 || exit 1
	if ! grep -q "^CONFIG_PACKAGE_$APP=" .config 2>/dev/null; then
		echo "CONFIG_PACKAGE_$APP=m" >> .config
		make defconfig >/dev/null 2>&1 || exit 1
	fi

	# The version is set in the SDK copy of the Makefile only: PKG_VERSION or PKG_RELEASE on
	# the make command line would also reach every other package built on the way.
	MK="$SDK/feeds/luci/applications/$APP/Makefile"
	if [ -n "$VER" ]; then
		sed -i "s/^PKG_VERSION:=.*/PKG_VERSION:=$VER/" "$MK"
	fi
	if [ -n "$REL" ]; then
		sed -i "s/^PKG_RELEASE:=.*/PKG_RELEASE:=$REL/" "$MK"
	fi

	stamp=$(mktemp)
	if ! make "package/feeds/luci/$APP/clean" "package/feeds/luci/$APP/compile" > /tmp/$APP-build-beta.log 2>&1; then
		rm -f "$stamp"
		echo "Build failed, see /tmp/$APP-build-beta.log" >&2
		exit 1
	fi
	find bin -name "$APP-*.apk" -newer "$stamp"
	rm -f "$stamp"
	exit 0
fi

[ $# -eq 2 ] || usage
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
