# luci-app-apmond

LuCI app for [ApmonD](https://github.com/openNDS/apmond), the access point monitoring daemon for OpenWrt.

The source stays in this repository. The [openwrt/luci](https://github.com/openwrt/luci) feed
carries only `applications/luci-app-apmond/Makefile`, a copy of
`linux_openwrt/luci-app-apmond/Makefile` with the release hash, which downloads the tagged release
from GitHub and installs from it, as the [apmond](https://github.com/openNDS/apmond) package does.

## apmond 2.x

This branch (`2.0.0beta`) is for apmond 2.x, the C daemon in
[openNDS/apmon](https://github.com/openNDS/apmon). It reads apmond over ubus, so it does not work
with apmond 1.x; use luci-app-apmond 1.0.1 there.

## Pages

Services > ApmonD has five tabs:

* **Settings** - the options of `config apmond 'setup'` in `/etc/config/apmond`, with a General
  and an Advanced tab, including the debug level. Every option is optional: the apmond defaults
  are shown as placeholders and an option is only written when you change it. While `apmon_seed`
  is not set a notice is shown, because apmond then uses its built-in default passphrase.
  Save & Apply restarts apmond through its init script's reload trigger (`service apmond reload`),
  which also gives `/etc/config/apmond` back to group `apmond` (mode 0640).
* **Status** - `ubus call apmond status` in groups, refreshed every 10 seconds. A replaced binary
  (restart needed), an unsynced clock, a rejected last report and the default passphrase are
  highlighted.
* **Access points** - on the collector, `ubus call apmond nodes`: one row per node with its ULA
  (a link to that node's page), IPv4 addresses, state (ok / late / lost and the report age),
  apmond package version and build, release, uptime, free RAM and clients, and a button to show
  its radios and clients (client MAC, SSID@interface or port@bridge, VLAN, VXLAN, signal,
  bitrates, bytes, last seen). Late and lost nodes and stale clients are greyed out, and lost
  nodes and stale clients have a Forget button. On a sender, a link to the page on the collector.
* **Clients** - on the collector, `ubus call apmond clients` with stale clients: every client of
  every node in one list, with a filter box and Forget for stale clients.
* **Log** - `apmond read_log`, with Refresh and Follow (re-read every 10 seconds).

## How it works

The app is plain LuCI JavaScript. There is no ucode, Lua, CGI or rpcd plugin: settings are a
standard `form.Map('apmond')`, and the other pages call the `apmond` ubus object through rpcd with
`rpc.declare()`. The rpcd ACL (`root/usr/share/rpcd/acl.d/luci-app-apmond.json`) allows reading
`status`, `nodes`, `node` and `clients`, writing `forget`, the uci config `apmond`, and one
command, `/usr/sbin/apmond read_log`.

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
htdocs/luci-static/resources/view/apmond/  # The views and common.js
root/usr/share/luci/menu.d/                # Menu entry, Services > ApmonD
root/usr/share/rpcd/acl.d/                 # rpcd ACL
po/templates/apmond.pot                    # Translation template
linux_openwrt/luci-app-apmond/Makefile     # OpenWrt package Makefile (feed template)
tests/                                     # View tests, run with node (not installed)
```

## Tests

`node tests/run-view-tests.js` loads the views with small stand-ins for the LuCI runtime and runs
their parsing and rendering code against real apmond 2.0 ubus output in `tests/samples`. The `tests`
directory is not installed.

## Translations

`po/templates/apmond.pot` is generated with the luci feed's `build/i18n-scan.pl`.
