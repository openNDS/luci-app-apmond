# luci-app-apmond

LuCI app for [ApmonD](https://github.com/openNDS/apmond), the access point monitoring daemon for OpenWrt.

The source stays in this repository. The [openwrt/luci](https://github.com/openwrt/luci) feed
carries only `applications/luci-app-apmond/Makefile`, a copy of
`linux_openwrt/luci-app-apmond/Makefile` with the release hash, which downloads the tagged release
from GitHub and installs from it, as the [apmond](https://github.com/openNDS/apmond) package does.

## Pages

Services > ApmonD has four tabs:

* **Settings** - the options of `config apmond 'setup'` in `/etc/config/apmond`, with a General
  and an Advanced tab. Every option is optional: the apmond defaults are shown as placeholders
  and an option is only written when you change it. While `apmon_seed` is not set a notice is
  shown, because apmond then uses its built-in default passphrase. Make ApmonD more secure by
  adding your own passphrase, the same on every node.
* **Status** - `apmond status` as a table, refreshed every 10 seconds. Problems are highlighted:
  a running daemon that differs from the installed one, a `log_mountpoint` that fell back to
  `/tmp`, logging disabled, nodes with a different protocol and a daemon that is enabled but not
  running. The default passphrase is shown as a plain note.
* **Access points** - on the collector (the router), `apmond show_ap_data all`: one row per
  access point, with a button to show its clients. On a peer, `apmond get_ap_data` is shown
  instead, for that node only; the full list is on the collector. Refreshed every 30 seconds.
* **Log** - `apmond read_log`, with a refresh button.

## How it works

The app is plain LuCI JavaScript. There is no ucode, Lua or rpcd plugin: settings are a
standard `form.Map('apmond')`, and the other pages run `/usr/sbin/apmond` with
`fs.exec_direct()` and parse its JSON in the browser. The rpcd ACL
(`root/usr/share/rpcd/acl.d/luci-app-apmond.json`) allows exactly these four commands:

    /usr/sbin/apmond status
    /usr/sbin/apmond show_ap_data all
    /usr/sbin/apmond get_ap_data
    /usr/sbin/apmond read_log

## Building

`linux_openwrt/luci-app-apmond/Makefile` is the feed Makefile (a template: `PKG_HASH` is filled in
for each release). It does not use `luci.mk`, because `luci.mk` packages the files next to the
Makefile; it does the same things for this app (LuCI > 3. Applications, depends on luci-base,
JavaScript minified when `CONFIG_LUCI_JSMIN` is set, LuCI cache cleared and rpcd reloaded on install).

To build a release, put the Makefile with the release hash at
`feeds/luci/applications/luci-app-apmond/Makefile` in an OpenWrt build tree or SDK, then:

    make package/luci-app-apmond/compile

To build the current checkout instead of a release, use a package directory containing only the
Makefile and a `git-src` symlink to this repository's `.git`, with `CONFIG_SRC_TREE_OVERRIDE=y`
(Advanced configuration options > Enable package source tree override). The committed tree at HEAD
is built.

## Layout

```
htdocs/luci-static/resources/view/apmond/  # The four views
root/usr/share/luci/menu.d/                # Menu entry, Services > ApmonD
root/usr/share/rpcd/acl.d/                 # rpcd ACL
po/templates/apmond.pot                    # Translation template
linux_openwrt/luci-app-apmond/Makefile     # OpenWrt package Makefile (feed template)
tests/                                     # View tests, run with node (not installed)
```

## Tests

`node tests/run-view-tests.js` loads the views with small stand-ins for the LuCI runtime and runs
their parsing and rendering code against real apmond output in `tests/samples`. The `tests`
directory is not installed.

## Translations

`po/templates/apmond.pot` is generated with the luci feed's `build/i18n-scan.pl`.
