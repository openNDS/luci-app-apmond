# luci-app-apmond 2.0.1 — release notes

Released Tue, 03 Nov 2026. Tag `v2.0.1` in [openNDS/luci-app-apmond](https://github.com/openNDS/luci-app-apmond).

## What's new in 2.0.1

A bug-fix release. All three fixes are in the shared view code (`common.js`); nothing else changed.

* **Go to collector keeps HTTPS.** The collector link uses the scheme the page was loaded with,
  instead of always `http://`.
* **Go to collector opens the collector in use.** The banner uses apmond's `collector` address
  (the collector ULA, the LAN IPv4 gateway fallback or a configured collector), falling back to
  the collector ULA. IPv6 addresses are bracketed in the URL; IPv4 addresses and names are not.
* **Failed calls are reported.** A failed nodes or clients call now shows the page's error instead
  of an empty list, and a failed Forget shows "Could not forget" instead of appearing to succeed.

Compatibility is unchanged: apmond 2.0 or later, OpenWrt 25.12 or later.

---

# luci-app-apmond 2.0.0

## Overview

luci-app-apmond is the LuCI app for apmond 2.x, the access point monitoring daemon in
[openNDS/apmond](https://github.com/openNDS/apmond). apmond monitors several OpenWrt access points
on one LAN, however they are linked (cabled, mesh, point-to-point, fibre or anything else); the
app shows its settings and data under Services > ApmonD on any of them.

## Compatibility

* Needs apmond 2.0 or later (`apmond` or `apmond-openssl`). The app reads the `apmond` ubus object
  through rpcd, so it does not work with apmond 1.x. For apmond 1.x use luci-app-apmond 1.0.1
  (branch `1.x`).
* OpenWrt 25.12 or later (apk).
* Plain LuCI JavaScript: no ucode, Lua, CGI or rpcd plugin, and no dependencies beyond luci-base
  and apmond.

## What's new in 2.0.0

* **Collector banner.** On an access point that is not the collector, Status, Access points and
  Clients start with "This node reports to the collector at <collector ULA>" and a **Go to
  collector** button, which opens the collector's Access points page in a new tab. The collector
  shows "This node is the collector." Most users open LuCI on whichever access point they know
  (often by its IPv4 address), so this is the way to the data of every access point.
* **Status:** `apmond status` in grouped tables, refreshed every 10 seconds, with warnings for a
  restart needed after an upgrade, an unsynced clock, a rejected last report and the default
  passphrase (the notice points to Settings).
* **Access points** (collector): one row per access point with state ok / late / lost and report
  age, apmond package version and build, release, uptime, free RAM and clients. Each node opens
  into a radio table (band, channel, mode, power, SSID, interface, VLAN / VXLAN when used) and its
  client table. Late and lost nodes and stale clients are greyed out and can be forgotten.
* **Clients** (collector): every client of every access point in one list, with a filter and
  Forget for stale clients. Wired clients show their port speed ("Link 100 Mbit/s").
* **Log:** `apmond read_log` with Refresh and Follow.
* **Settings:** the apmond 2.x options (role, port, collector, interface, netdev, key_epoch,
  prev_epoch_grace, client_stale_timeout, max_message_size, debug level), with the passphrase as a
  password field. Save & Apply restarts apmond through its reload trigger.
* **ACL:** ubus `apmond` status, nodes, node, clients (read) and forget (write), uci `apmond`,
  and the one command `/usr/sbin/apmond read_log`.

## Upgrading from 1.x

Upgrade apmond to 2.x on every access point first (all access points must run the same protocol),
then install luci-app-apmond 2.0.0. The 1.x options that apmond 2.x no longer has are not shown.

## Known issues

* None specific to the app. See the apmond 2.0.0 release notes.
