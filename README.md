# luci-app-apmond

LuCI app for [ApmonD](https://github.com/openNDS/apmond), the access point monitoring daemon for OpenWrt.

The repository is laid out exactly as `applications/luci-app-apmond/` in the
[openwrt/luci](https://github.com/openwrt/luci) feed, so it can be copied there unchanged.

## Pages

Services > ApmonD has four tabs:

* **Settings** - the options of `config apmond 'setup'` in `/etc/config/apmond`, with a General
  and an Advanced tab. Every option is optional: the apmond defaults are shown as placeholders
  and an option is only written when you change it. While `apmon_seed` is not set a warning is
  shown, because apmond then uses its insecure built-in default passphrase. The passphrase must
  be the same on every node.
* **Status** - `apmond status` as a table, refreshed every 10 seconds. Problems are highlighted:
  a running daemon that differs from the installed one, the default passphrase, a
  `log_mountpoint` that fell back to `/tmp`, logging disabled, nodes with a different protocol
  and a daemon that is enabled but not running.
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

Copy (do not symlink) the repository to `feeds/luci/applications/luci-app-apmond` in an OpenWrt
build tree or SDK, then select and build it as usual:

    make package/luci-app-apmond/compile

## Tests

`node tests/run-view-tests.js` loads the views with small stand-ins for the LuCI runtime and runs
their parsing and rendering code against real apmond output in `tests/samples`. The `tests`
directory is not installed and is not needed in the luci feed.

## Translations

`po/templates/apmond.pot` is generated with the luci feed's `build/i18n-scan.pl`.
