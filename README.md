# luci-app-apmond

LuCI app for [ApmonD](https://github.com/openNDS/apmond), the access point monitoring daemon for OpenWrt.

Development happens here. The app directory `openwrt/luci-app-apmond/` is laid out exactly like
`applications/luci-app-apmond` in [openwrt/luci](https://github.com/openwrt/luci) (a `luci.mk`
Makefile, `htdocs/`, `root/` and `po/`), and a feed pull request is a straight copy of it.

## Workflow

* Work is done on a beta branch (for example `2.0.2beta`) and merged to `master` through a pull
  request in this repository.
* A release is tagged on `master` (`vX.Y.Z`).
* For the feed, copy the app directory into an openwrt/luci checkout and open or update the pull
  request there:

      tools/feed-sync.sh copy  /path/to/openwrt-luci    # replaces applications/luci-app-apmond
      tools/feed-sync.sh check /path/to/openwrt-luci    # diff only; exit 0 if they match

  The Makefile here is the one that goes into openwrt/luci, so it changes only together with the
  feed copy.

## apmond 2.x

luci-app-apmond 2.x is for apmond 2.x, the C daemon in
[openNDS/apmond](https://github.com/openNDS/apmond). It reads apmond over ubus, so it does not work
with apmond 1.x; use luci-app-apmond 1.0.1 (branch `1.x`) there.

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
* **Access points** - on the collector, `ubus call apmond nodes`: one row per node with a short
  LuCI link to that node (its ULA as tooltip), IPv4 addresses, state (ok / late / lost and the
  report age), apmond package version and build, release, uptime, free RAM and clients. "Show
  clients" opens the node's detail, indented under its row: a radio table (one row per AP: band,
  channel, mode, power, SSID, interface, and VLAN / VXLAN when used) and the client table.
  Client columns that are empty for every client are left out. Late and lost nodes and stale
  clients are greyed out, and lost nodes and stale clients have a Forget button.
* **Collector banner** - on a sender, Status, Access points and Clients start with "This node
  reports to the collector at <address>" and a "Go to collector" button that opens the
  collector's Access points page in a new tab, in the scheme the page was loaded with (https
  stays https). The address is the collector in use (`collector` in apmond status: the collector
  ULA, the LAN IPv4 gateway fallback or a configured collector), so
  the data of every access point can be reached from LuCI on any of them. On the collector, a small "This
  node is the collector." note.
* **Clients** - on the collector, `ubus call apmond clients` with stale clients: every client of
  every node in one list, the same columns as on Access points plus the node, with a filter box
  and Forget for stale clients.
* **Log** - `apmond read_log`, with Refresh and Follow (re-read every 10 seconds).

## How it works

The app is plain LuCI JavaScript. There is no ucode, Lua, CGI or rpcd plugin: settings are a
standard `form.Map('apmond')`, and the other pages call the `apmond` ubus object through rpcd with
`rpc.declare()`. The rpcd ACL (`openwrt/luci-app-apmond/root/usr/share/rpcd/acl.d/luci-app-apmond.json`) allows reading
`status`, `nodes`, `node` and `clients`, writing `forget`, the uci config `apmond`, and one
command, `/usr/sbin/apmond read_log`.

## Building

`openwrt/luci-app-apmond/Makefile` uses `../../luci.mk`, so it builds inside the luci feed tree.
In an OpenWrt build tree or SDK with the luci feed installed:

    tools/feed-sync.sh copy feeds/luci
    ./scripts/feeds update -i luci
    ./scripts/feeds install -p luci luci-app-apmond
    make package/feeds/luci/luci-app-apmond/compile

`luci.mk` handles JavaScript minification (`CONFIG_LUCI_JSMIN`), translations and the LuCI cache
clear and rpcd reload on install. The minimum apmond version is set with `LUCI_EXTRA_DEPENDS`.

## Layout

```
openwrt/luci-app-apmond/                     # = applications/luci-app-apmond in openwrt/luci
  Makefile                                   # luci.mk package Makefile, as in the feed
  htdocs/luci-static/resources/view/apmond/  # The views and common.js
  root/usr/share/luci/menu.d/                # Menu entry, Services > ApmonD
  root/usr/share/rpcd/acl.d/                 # rpcd ACL
  po/templates/apmond.pot                    # Translation template
tools/feed-sync.sh                           # Copy to / check against an openwrt/luci checkout
tests/                                       # View tests, run with node (not installed)
```

## Tests

`node tests/run-view-tests.js` loads the views with small stand-ins for the LuCI runtime and runs
their parsing and rendering code against real apmond 2.0 ubus output in `tests/samples`. The `tests`
directory is not installed.

## Translations

`openwrt/luci-app-apmond/po/templates/apmond.pot` is generated in the openwrt/luci checkout,
after a copy, with `./build/i18n-scan.pl applications/luci-app-apmond > applications/luci-app-apmond/po/templates/apmond.pot`,
and copied back, so its paths are the feed paths.
