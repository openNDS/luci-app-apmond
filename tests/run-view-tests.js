#!/usr/bin/env node
// Load the LuCI views with minimal stand-ins for the LuCI runtime and run their parsing and
// render helpers against real apmond output (tests/samples). Usage: node tests/run-view-tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const VIEWS = process.env.VIEWS || path.join(ROOT, 'htdocs/luci-static/resources/view/apmond');
const SAMPLES = path.join(__dirname, 'samples');
const sample = (f) => fs.readFileSync(path.join(SAMPLES, f), 'utf8');

// LuCI String.prototype.format, only %s is used by the views
String.prototype.format = function() {
	let i = 0, args = arguments;
	return this.replace(/%s/g, () => String(args[i++]));
};

// E() builds a plain tree: { tag, attrs, children }
function E(tag, attrs, children) {
	if (Array.isArray(tag)) return { tag: 'fragment', attrs: {}, children: tag };
	if (Array.isArray(attrs) || typeof attrs === 'string') { children = attrs; attrs = {}; }
	children = children == null ? [] : (Array.isArray(children) ? children : [ children ]);
	return { tag, attrs: attrs || {}, children, style: {}, firstChild: { data: '' } };
}
function text(n) {
	if (n == null || n === '') return '';
	if (typeof n !== 'object') return String(n);
	return n.children.map(text).join(' ');
}
function find(n, tag, out) {
	out = out || [];
	if (n && typeof n === 'object') { if (n.tag === tag) out.push(n); n.children.forEach((c) => find(c, tag, out)); }
	return out;
}

function loadView(name, fakes) {
	const src = fs.readFileSync(path.join(VIEWS, name + '.js'), 'utf8');
	const env = Object.assign({
		view: { extend: (o) => o }, baseclass: { extend: (o) => o },
		apmondver: name === 'version' ? undefined : loadView('version', { fs: { exec_direct: () => Promise.resolve('apmond version 1.0.1~be7a\n') } }),
		form: {}, fs: {}, ui: {}, poll: { add: () => {} }, dom: { content: () => {} }, uci: {},
		L: { resolveDefault: (p, d) => Promise.resolve(p).catch(() => d), resource: (p) => '/luci-static/resources/' + p },
		E, _: (s) => s
	}, fakes || {});
	const names = Object.keys(env);
	return new Function(...names, src).apply(null, names.map((k) => env[k]));
}

let pass = 0;
function ok(msg) { pass++; console.log('PASS: ' + msg); }

(async () => {
	// Status
	const st = loadView('status');
	const r = st.parseStatus(sample('status_router.json'));
	assert.strictEqual(r.role, 'router'); ok('status: router status parsed');
	// the mock harness runs commands without a daemon: the sample says daemon_running no
	assert.deepStrictEqual(st.statusWarnings(r), [ 'ApmonD is enabled but the daemon is not running.' ]);
	assert.deepStrictEqual(st.statusWarnings(Object.assign({}, r, { daemon_running: 'yes' })), []); ok('status: no other warnings for a healthy router');
	const rows = st.statusRows(r);
	assert.ok(rows.length >= 30 && rows.every((x) => typeof x[2] === 'string')); ok('status: ' + rows.length + ' rows, all text');
	assert.ok(rows.find((x) => x[0] === 'ula_addresses')[2].includes('fd18:cef4:6dbd:baa0::1/64')); ok('status: ula_addresses object shown');
	assert.ok(rows.find((x) => x[0] === 'last_send')[2].includes('return code 0')); ok('status: last_send object shown');
	assert.strictEqual(rows.find((x) => x[0] === 'router_detect')[2], '1 (auto detect)'); ok('status: router_detect labelled');
	assert.strictEqual(rows.find((x) => x[0] === 'protocol_mismatch_nodes')[2], 'none'); ok('status: empty array shown as none');
	const p = st.parseStatus(sample('status_peer.json'));
	assert.strictEqual(p.role, 'unknown (daemon not run yet)'); ok('status: peer status parsed (role before the daemon has run)');

	const bad = JSON.parse(sample('status_router.json'));
	Object.assign(bad.apmond_status, {
		daemon_running: 'yes', checksum: 'aaaa',
		checksum_warning: 'running daemon differs from /usr/sbin/apmond - restart apmond',
		default_passphrase: 'yes', passphrase_warning: 'The built-in default passphrase is in use. Make ApmonD more secure by setting option apmon_seed in /etc/config/apmond (the same on every node)',
		storage_warning: 'log_mountpoint [ /mnt/usb ] is not mounted - falling back to /tmp',
		logging: 'DISABLED: Log location is NOT a mountpoint',
		protocol_mismatch_nodes: [ '020000aa0009' ]
	});
	const b = st.parseStatus(JSON.stringify(bad));
	const w = st.statusWarnings(b);
	assert.strictEqual(w.length, 4, w.join('\n')); ok('status: checksum, storage, logging and protocol warnings');
	assert.ok(!w.some((x) => /passphrase/.test(x)));
	assert.deepStrictEqual(st.statusNotes(b), [ bad.apmond_status.passphrase_warning ]);
	assert.ok(st.statusNotes({ default_passphrase: 'yes' })[0].includes('adding your own passphrase in Settings'));
	assert.deepStrictEqual(st.statusNotes({ default_passphrase: 'no' }), []); ok('status: default passphrase is a note, not a warning (apmond text, or the fallback)');
	const brows = st.statusRows(b);
	[ 'checksum', 'installed_checksum', 'log_mountpoint', 'logging', 'protocol_mismatch_nodes' ]
		.forEach((k) => assert.ok(brows.find((x) => x[0] === k)[3], k));
	assert.strictEqual(brows.find((x) => x[0] === 'default_passphrase')[3], false);
	assert.strictEqual(brows.find((x) => x[0] === 'default_passphrase')[2], 'yes'); ok('status: Default passphrase in use yes is plain text, not highlighted');
	assert.ok(!brows.find((x) => x[0] === 'checksum_warning') && !brows.find((x) => x[0] === 'passphrase_warning')); ok('status: warning rows highlighted, warning keys not repeated in the table');
	assert.ok(st.statusWarnings(st.parseStatus('{"apmond_status":{"enabled":"1","daemon_running":"no"}}'))[0].includes('not running')); ok('status: enabled but not running warned');
	[ null, '', 'garbage', '[]', '{"x":1}' ].forEach((t) => assert.strictEqual(st.parseStatus(t), null));
	ok('status: empty or bad output gives null');
	assert.ok(text(st.renderStatus(sample('status_router.json'))).includes('router')); ok('status: renderStatus renders');
	const rs = st.renderStatus(JSON.stringify(bad));
	const notice = rs.children.find((c) => c && c.attrs && c.attrs.class === 'alert-message notice');
	const warnbox = rs.children.find((c) => c && c.attrs && c.attrs.class === 'alert-message warning');
	assert.ok(text(notice).includes('Make ApmonD more secure by setting option apmon_seed'));
	assert.ok(!text(warnbox).includes('passphrase') && text(warnbox).includes('restart apmond'));
	const pr = find(rs, 'tr').find((r) => text(r).includes('Default passphrase in use'));
	assert.ok(!pr.children[1].attrs.style); ok('status: renderStatus shows the passphrase note in a plain notice box, warnings separately');
	const rs2 = st.renderStatus(JSON.stringify({ apmond_status: { enabled: '1', daemon_running: 'yes', default_passphrase: 'no' } }));
	assert.ok(!rs2.children.find((c) => c && c.attrs && /alert-message/.test(c.attrs.class || ''))); ok('status: no boxes when there is nothing to report');
	assert.ok(text(st.renderStatus('')).includes('Could not read')); ok('status: renderStatus with no output');

	// Access points
	const ap = loadView('accesspoints');
	const nodes = ap.parseNodes(ap.parseJSON(sample('show_ap_data_all.json')));
	assert.strictEqual(nodes.length, 2); ok('ap: show_ap_data all gives 2 nodes');
	assert.strictEqual(nodes[0].mac, '02:00:00:0a:00:00');
	assert.strictEqual(nodes[0].clients.length, 5); ok('ap: 5 clients (3 wireless on 2 SSIDs, 2 wired)');
	const wl = nodes[0].clients.find((c) => c.where === 'OpenWrt@phy0-ap0');
	assert.ok(!wl.wired && !wl.per_port);
	assert.strictEqual(ap.text(wl.tx_bitrate), '433.3 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 1');
	assert.strictEqual(ap.text(wl.signal), '-51 [-53, -54] dBm');
	assert.strictEqual(ap.formatDuration(wl.connected_time), '10s'); ok('ap: wireless values shown with spaces');
	const wd = nodes[0].clients.find((c) => c.where === 'apmdum0@apmbr0');
	assert.ok(wd.wired && wd.per_port);
	assert.strictEqual(ap.formatBitrate(wd.tx_bitrate), '10000 Mbit/s'); ok('ap: wired client marked per port, speed in Mbit/s');
	assert.strictEqual(ap.formatBytes('1866'), '1.82 KiB');
	assert.strictEqual(ap.formatBytes('1000'), '1000 B');
	assert.strictEqual(ap.formatBytes('33899428'), '32.33 MiB');
	assert.strictEqual(ap.formatKiB(3525444), '3.36 GiB');
	assert.strictEqual(ap.formatKiB('unknown'), 'unknown');
	assert.strictEqual(ap.formatDuration(7112), '1h 58m 32s');
	assert.strictEqual(ap.formatDuration('4100_seconds'), '1h 8m 20s');
	assert.strictEqual(ap.formatBitrate('down'), 'down'); ok('ap: formatting helpers');
	const t = ap.renderNodes(nodes);
	assert.strictEqual(find(t, 'button').length, 2);
	assert.ok(text(t).includes('(per port)') && text(t).includes('OpenWrt5@phy1-ap0')); ok('ap: renderNodes renders a row and a client table per node');

	// fixed column widths: every client table (and the node table) has the same widths, summing to 100%
	const widthsOf = (tbl) => tbl.children[0].children.map((c) => c.attrs.style.match(/width:([0-9]+)%/)[1]);
	const ctabs = find(t, 'table').slice(1);
	assert.strictEqual(ctabs.length, 2);
	assert.ok(ctabs.every((x) => /table-layout:fixed/.test(x.attrs.style)));
	assert.deepStrictEqual(widthsOf(ctabs[0]), widthsOf(ctabs[1]));
	assert.strictEqual(widthsOf(ctabs[0]).length, 9);
	assert.strictEqual(widthsOf(ctabs[0]).reduce((a, b) => a + +b, 0), 100);
	ctabs.forEach((x) => x.children.slice(1).forEach((row) => assert.deepStrictEqual(widthsOf({ children: [ row ] }), widthsOf(ctabs[0]))));
	ok('ap: client tables of both nodes use identical fixed column widths summing to 100%');
	assert.ok(/table-layout:fixed/.test(t.attrs.style) && widthsOf(t).length === 10 && widthsOf(t).reduce((a, b) => a + +b, 0) === 100);
	ok('ap: node table has fixed column widths summing to 100%');
	const dtd = find(t, 'td').filter((c) => c.attrs.colspan);
	assert.ok(dtd.length === 2 && dtd.every((c) => c.attrs.colspan === '10')); ok('ap: client table row spans all 10 node columns');

	// node addresses (apmond 1.0.1): node_ula and ipv4_addresses right after device_mac
	const titles = t.children[0].children.map(text);
	assert.deepStrictEqual(titles.slice(0, 5), [ 'Device', 'MAC address', 'ULA', 'IPv4 address', 'Release' ]); ok('ap: ULA and IPv4 address columns after MAC address');
	// older APs (the apmond 1.0.0 sample has no node_ula / ipv4_addresses): "-" and no link
	assert.ok(nodes.every((n) => n.ula === null && Array.isArray(n.ipv4) && n.ipv4.length === 0));
	assert.strictEqual(find(t, 'a').length, 0);
	const oldRow = t.children[1];
	assert.ok(text(oldRow.children[2]) === '-' && text(oldRow.children[3]) === '-'); ok('ap: older AP report: ULA and IPv4 show -, no link');
	const na = ap.parseNodes(ap.parseJSON(sample('show_ap_data_addresses.json')));
	const nc = na.find((n) => n.mac === '02:00:00:0a:00:00'), nr = na.find((n) => n.mac === '02:00:00:0a:00:01');
	assert.strictEqual(nc.ula, 'fd18:cef4:6dbd:baa0:200:ff:fe0a:0');
	assert.deepStrictEqual(nc.ipv4, [ '192.168.1.2/24', '10.10.0.2/16' ]);
	assert.strictEqual(nr.ula, 'fd18:cef4:6dbd:baa0:200:ff:fe0a:1');
	assert.deepStrictEqual(nr.ipv4, []); ok('ap: apmond 1.0.1 report: node_ula and ipv4_addresses parsed');
	const tn = ap.renderNodes(na);
	const links = find(tn, 'a');
	assert.strictEqual(links.length, 2);
	const lc = links.find((x) => text(x) === nc.ula);
	assert.strictEqual(lc.attrs.href, 'https://[fd18:cef4:6dbd:baa0:200:ff:fe0a:0]/cgi-bin/luci/admin/services/apmond/accesspoints');
	assert.ok(lc.attrs.target === '_blank' && lc.attrs.rel === 'noopener' && lc.attrs.title === lc.attrs.href);
	ok('ap: ULA links to the AP\'s Access points page in a new window, as the peer note links to the collector');
	assert.strictEqual(ap.nodeURL('fd18:cef4:6dbd:baa0::1'), ap.collectorURL('fd18:cef4:6dbd:baa0::1')); ok('ap: AP and collector links use the same URL form');
	const rowC = tn.children.slice(1).find((r) => r.children && text(r.children[1]) === nc.mac);
	assert.strictEqual(text(rowC.children[3]), '192.168.1.2/24  10.10.0.2/16');
	assert.strictEqual(find(rowC.children[3], 'br').length, 1);
	const rowR = tn.children.slice(1).find((r) => r.children && text(r.children[1]) === nr.mac);
	assert.strictEqual(text(rowR.children[3]), '-'); ok('ap: IPv4 addresses one per line, - when the AP has none');
	// a mesh11sd AP (mesh11sd node_status: mesh_bridge_mac, no node_ula) mixed with apmond APs
	const mixedAll = JSON.parse(sample('show_ap_data_addresses.json'));
	mixedAll['System@02:00:00:0b:00:00'] = { Device: 'mesh11sd AP', node_status: { mesh11sd_version: '7.3.1', mesh_bridge_mac: '02:00:00:0b:00:00', uptime_seconds: 5 } };
	const nm = ap.parseNodes(mixedAll);
	const m11 = nm.find((n) => n.mac === '02:00:00:0b:00:00');
	assert.ok(nm.length === 3 && m11.ula === null && m11.ipv4.length === 0);
	assert.strictEqual(find(ap.renderNodes(nm), 'a').length, 2); ok('ap: mesh11sd AP: - and no link, apmond APs still linked');
	// only a real ULA becomes a link, never anything else a report might carry
	[ 'unknown', '', null, 'javascript:alert(1)', 'fe80::1', '2001:db8::1', 'fd00::1"><b', 'fd00::1/64', 42, [ 'fd00::1' ] ]
		.forEach((v) => assert.strictEqual(ap.parseULA(v), null, String(v)));
	assert.strictEqual(ap.parseULA('FD18:CEF4::1'), 'fd18:cef4::1');
	assert.deepStrictEqual(ap.parseIPv4('192.168.1.2/24'), []);
	assert.deepStrictEqual(ap.parseIPv4([ '192.168.1.2', '10.0.0.1/8', 'x', '1.2.3.4/24"><b', null ]), [ '192.168.1.2', '10.0.0.1/8' ]);
	ok('ap: node_ula must be a ULA and ipv4_addresses dotted quads, anything else gives - and no link');
	const mixed = ap.renderClients({ clients: [ wl, wd ] });
	assert.ok(mixed.children.slice(1).every((row) => row.children.every((c) => /overflow-wrap:anywhere/.test(c.attrs.style) && c.attrs['data-title'])));
	ok('ap: client cells wrap long values and carry data-title labels for the mobile layout');

	// signal icons: luci-mod-status 60_wifi.js mapping q = min((dBm + 110) / 70 * 100, 100)
	assert.strictEqual(ap.parseSignal('-29_[-35,_-31]_dBm'), -29);
	assert.strictEqual(ap.parseSignal('-29 [-34, -31] dBm'), -29);
	assert.strictEqual(ap.parseSignal(' -51 dBm'), -51);
	[ null, undefined, '', 'unknown', 'n/a dBm', '-29.5 dBm' ].forEach((v) => assert.strictEqual(ap.parseSignal(v), null, String(v)));
	ok('ap: leading dBm parsed from iw signal strings, unparseable gives null');
	[ [ -120, '000-000' ], [ -110, '000-000' ], [ -109, '000-025' ], [ -93, '000-025' ], [ -92.5, '025-050' ], [ -92, '025-050' ],
	  [ -76, '025-050' ], [ -75, '050-075' ], [ -58, '050-075' ], [ -57.5, '075-100' ], [ -57, '075-100' ], [ -29, '075-100' ], [ 0, '075-100' ] ]
		.forEach(([ dbm, icon ]) => assert.strictEqual(ap.signalIcon(dbm), 'icons/signal-' + icon + '.svg', String(dbm)));
	ok('ap: signal icon per threshold, including the edge values');
	const sig = ap.renderSignal({ wired: false, signal: '-29_[-35,_-31]_dBm' });
	const img = find(sig, 'img');
	assert.strictEqual(img.length, 1);
	assert.strictEqual(img[0].attrs.src, '/luci-static/resources/icons/signal-075-100.svg');
	assert.strictEqual(sig.attrs.title, 'Signal: -29 dBm (antennas: -35, -31 dBm)');
	assert.ok(!sig.attrs.class && /white-space:nowrap/.test(sig.attrs.style), 'no badge box, one line');
	assert.strictEqual(text(sig).trim(), '-29 dBm'); ok('ap: wireless signal shows no box, the icon and the leading dBm, antennas in the tooltip');
	const sig2 = ap.renderSignal({ wired: false, signal: '-38 [-44, -39] dBm' });
	assert.strictEqual(sig2.attrs.title, 'Signal: -38 dBm (antennas: -44, -39 dBm)');
	assert.strictEqual(find(sig2, 'img')[0].attrs.src, '/luci-static/resources/icons/signal-075-100.svg');
	const sig3 = ap.renderSignal({ wired: false, signal: '-61_dBm' });
	assert.strictEqual(sig3.attrs.title, 'Signal: -61 dBm');
	assert.strictEqual(text(sig3).trim(), '-61 dBm');
	assert.deepStrictEqual(ap.parseAntennas('-38_[-44,_-39]_dBm'), [ -44, -39 ]);
	assert.deepStrictEqual(ap.parseAntennas('-61 dBm'), []); ok('ap: tooltip with and without per antenna values');
	assert.strictEqual(ap.renderSignal({ wired: true, signal: '-29 dBm' }), '-');
	assert.strictEqual(ap.renderSignal(wd), '-'); ok('ap: wired clients keep -');
	assert.strictEqual(ap.renderSignal({ wired: false, signal: 'unknown' }), 'unknown');
	assert.strictEqual(find(ap.renderClients({ clients: [ wd ] }), 'img').length, 0); ok('ap: unparseable signal is text only, no icon');
	assert.strictEqual(find(t, 'img').length, nodes.reduce((a, n) => a + n.clients.filter((c) => !c.wired && ap.parseSignal(c.signal) != null).length, 0));
	ok('ap: one signal icon per wireless client in renderNodes');

	const own = ap.parseNodes(ap.parseJSON(sample('get_ap_data_peer.json')));
	assert.strictEqual(own.length, 1); ok('ap: get_ap_data gives this node only');
	const real = ap.parseNodes(ap.parseJSON(sample('get_ap_data_gl-mt300n-v2.json')));
	assert.strictEqual(real.length, 1);
	assert.strictEqual(real[0].device, 'GL-MT300N-V2');
	const rc = real[0].clients[0];
	assert.strictEqual(rc.vlan, '20');
	assert.strictEqual(ap.text(rc.tx_bitrate), '72.2 MBit/s MCS 7 short GI');
	assert.strictEqual(ap.formatDuration(rc.connected_time), '1h 8m 20s');
	assert.ok(text(ap.renderNodes(real)).includes('guest-f9d1@phy0-ap1')); ok('ap: real GL-MT300N-V2 report (guest client on VLAN 20)');
	[ '', null, '\n  }\n}', 'Invalid ap_mac_id [ x ]' ].forEach((x) => assert.deepStrictEqual(ap.parseNodes(ap.parseJSON(x)), []));
	ok('ap: empty or broken output gives no nodes');

	// fetchData: collector, and peer fallback, with a fake fs.exec_direct
	const calls = [];
	const mk = (answers) => loadView('accesspoints', { fs: { exec_direct: (cmd, args) => {
		calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(answers[args[0]]); } } });
	const peerStatus = sample('status_peer.json');
	let d = await mk({ show_ap_data: sample('show_ap_data_all.json') }).fetchData();
	assert.ok(d.collector && d.nodes.length === 2); ok('ap: fetchData on the collector');
	d = await mk({ show_ap_data: '', get_ap_data: sample('get_ap_data_peer.json'), status: peerStatus }).fetchData();
	assert.ok(!d.collector && d.nodes.length === 1); ok('ap: fetchData on a peer falls back to get_ap_data');
	assert.ok(calls.includes('/usr/sbin/apmond status')); ok('ap: peer fallback reads apmond status');
	assert.strictEqual(d.collector_ula, 'fd18:cef4:6dbd:baa0::1'); ok('ap: collector ULA from status');
	const pn = ap.renderData(Object.assign({}, d, { role: 'peer' }));
	assert.ok(text(pn).includes('Not a collector.') && text(pn).includes('fd18:cef4:6dbd:baa0::1')); ok('ap: peer note says not a collector and names the collector');
	const a = find(pn, 'a')[0];
	assert.strictEqual(a.attrs.href, 'https://[fd18:cef4:6dbd:baa0::1]/cgi-bin/luci/admin/services/apmond/accesspoints'); ok('ap: link to the collector Access points page');
	assert.ok(text(a) === 'here' && a.attrs.target === '_blank' && text(pn).replace(/\s+/g, ' ').includes('Click here to open the collector')); ok('ap: "here" link opens a new window');
	assert.ok(find(ap.renderData(Object.assign({}, d, { role: 'backed-off' })), 'a').length === 1); ok('ap: backed-off router gets the link too');
	const rn = ap.renderData(Object.assign({}, d, { role: 'router' }));
	assert.ok(text(rn).includes('This node is the collector.') && find(rn, 'a').length === 0); ok('ap: collector with no reports yet, no link');
	assert.ok(text(ap.renderData(Object.assign({}, d, { role: '', collector_ula: '' }))).includes('Not a collector, or')); ok('ap: unknown role, generic note');
	assert.ok(text(ap.renderData({ collector: false, nodes: [] })).includes('No access point data')); ok('ap: no data message');
	const en = ap.renderData({ collector: false, nodes: [], role: 'peer', collector_ula: 'fd18:cef4:6dbd:baa0::1' });
	assert.ok(text(en).includes('Not a collector.') && find(en, 'a').length === 1 && text(en).includes('no clients connected')); ok('ap: peer with no own data still gets the notice and link');
	assert.ok(!text(en).includes('Only this node is shown') && text(pn).includes('Only this node is shown')); ok('ap: "only this node" only when this node is shown');

	// own row: this node's ULA is plain text, other nodes' ULAs stay links
	const routerStatus = sample('status_router.json');
	const addrAll = sample('show_ap_data_addresses.json');
	const ulaLinks = (tbl) => find(tbl, 'a').map(text);

	// collector: status_router.json is the 02:00:00:0a:00:01 node of show_ap_data_addresses.json
	d = await mk({ show_ap_data: addrAll, status: routerStatus }).fetchData();
	assert.ok(d.collector && d.nodes.length === 2);
	const ownC = d.nodes.find((n) => n.own);
	assert.strictEqual(ownC.mac, '02:00:00:0a:00:01');
	assert.strictEqual(d.nodes.filter((n) => n.own).length, 1);
	ok('ap: collector marks its own row from node_ula / ap_mac_id in apmond status');

	const tc = ap.renderData(d);
	assert.deepStrictEqual(ulaLinks(tc), [ 'fd18:cef4:6dbd:baa0:200:ff:fe0a:0' ]);
	const ownRow = find(tc, 'tr').find((r) => r.children.length > 1 && text(r.children[1]) === ownC.mac);
	assert.strictEqual(text(ownRow.children[2]), ownC.ula);
	assert.strictEqual(find(ownRow.children[2], 'a').length, 0);
	ok('ap: collector own row shows its ULA as plain text, the other AP is still a link');

	// own row found by MAC alone (upper case), and by ULA alone
	assert.ok(ap.isOwnNode({ mac: '02:00:00:0a:00:01', ula: null }, { ap_mac_id: '02:00:00:0A:00:01' }));
	assert.ok(ap.isOwnNode({ mac: 'x', ula: 'fd18:cef4:6dbd:baa0:200:ff:fe0a:1' }, { node_ula: 'FD18:CEF4:6DBD:BAA0:200:FF:FE0A:1' }));
	assert.ok(!ap.isOwnNode({ mac: '02:00:00:0a:00:00', ula: null }, { ap_mac_id: '02:00:00:0a:00:01', node_ula: 'unknown' }));
	assert.ok(!ap.isOwnNode({ mac: '', ula: null }, {}));
	ok('ap: own node matched by MAC or ULA, an empty or unknown status matches nothing');

	// collector with no status output: no row is marked, every ULA stays a link
	d = await mk({ show_ap_data: addrAll }).fetchData();
	assert.ok(d.nodes.every((n) => !n.own));
	assert.strictEqual(ulaLinks(ap.renderData(d)).length, 2);
	ok('ap: collector without apmond status keeps every ULA a link');

	// non-collector: get_ap_data is this node only, its ULA is plain text, only the "here" link remains
	const ownReport = {};
	ownReport['System@02:00:00:0a:00:00'] = JSON.parse(addrAll)['System@02:00:00:0a:00:00'];
	d = await mk({ show_ap_data: '', get_ap_data: JSON.stringify(ownReport), status: peerStatus }).fetchData();
	assert.ok(!d.collector && d.nodes.length === 1 && d.nodes[0].own);

	const tp = ap.renderData(Object.assign({}, d, { role: 'peer' }));
	assert.deepStrictEqual(ulaLinks(tp), [ 'here' ]);
	assert.ok(text(tp).includes('fd18:cef4:6dbd:baa0:200:ff:fe0a:0'));
	ok('ap: non-collector single row shows its own ULA as plain text, only the collector link remains');

	// collector: apmond status is read once for this node's identity, not on every refresh
	let statusCalls = 0;
	let statusOut = routerStatus;
	const cached = loadView('accesspoints', { fs: { exec_direct: (cmd, args) => {
		if (args[0] === 'status') {
			statusCalls++;
			return Promise.resolve(statusOut);
		}

		return Promise.resolve(args[0] === 'show_ap_data' ? addrAll : '');
	} } });

	await cached.fetchData();
	d = await cached.fetchData();
	d = await cached.fetchData();
	assert.strictEqual(statusCalls, 1);
	assert.strictEqual(d.nodes.find((n) => n.own).mac, '02:00:00:0a:00:01');
	ok('ap: collector reads apmond status once, the own row stays marked on later refreshes');

	// status not ready at first: nothing marked, tried again on the next refresh, then kept
	const retry = loadView('accesspoints', { fs: { exec_direct: (cmd, args) => {
		if (args[0] === 'status') {
			statusCalls++;
			return Promise.resolve(statusOut);
		}

		return Promise.resolve(args[0] === 'show_ap_data' ? addrAll : '');
	} } });

	statusCalls = 0;
	statusOut = '';
	d = await retry.fetchData();
	assert.ok(d.nodes.every((n) => !n.own));
	statusOut = routerStatus;
	d = await retry.fetchData();
	d = await retry.fetchData();
	assert.strictEqual(statusCalls, 2);
	assert.strictEqual(d.nodes.filter((n) => n.own).length, 1);
	ok('ap: empty apmond status is not kept, the next refresh reads it again');

	// header cells wrap only between words, data cells may wrap anywhere
	const heads = find(tc, 'th');
	assert.ok(heads.every((h) => !/overflow-wrap:anywhere/.test(h.attrs.style)));
	assert.ok(find(tc, 'td').some((c) => /overflow-wrap:anywhere/.test(c.attrs.style)));
	ok('ap: column titles are never split inside a word');
	const acl = JSON.parse(fs.readFileSync(path.join(ROOT, 'root/usr/share/rpcd/acl.d/luci-app-apmond.json')))['luci-app-apmond'].read.file;
	const st2 = loadView('status', { fs: { exec_direct: (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(''); } } });
	const lg = loadView('log', { fs: { exec_direct: (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(''); } } });
	const vv = loadView('version', { fs: { exec_direct: (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(''); } } });
	await st2.fetchStatus(); await lg.fetchLog(); await vv.fetchApmondVersion();
	calls.forEach((c) => assert.ok(acl[c] && acl[c].includes('exec'), 'not in ACL: ' + c));
	assert.strictEqual(Object.keys(acl).length, new Set(calls).size); ok('acl: every command the views run is allowed, and nothing else (' + [ ...new Set(calls) ].join(', ') + ')');

	// Log
	const lv = loadView('log');
	assert.ok(lv.logText(sample('read_log.txt')).includes('daemon.')); ok('log: log text shown');
	assert.ok(lv.logText('').includes('empty') && lv.logText(null).includes('Could not')); ok('log: empty and failed reads');

	// Settings helpers
	const sv = loadView('settings');
	assert.ok(sv.seedIsDefault(undefined) && sv.seedIsDefault('') && sv.seedIsDefault('--__') && !sv.seedIsDefault('my secret'));
	ok('settings: default passphrase detection');

	const opts = [], tabs = [];
	function Opt(type, name) { this.type = type; this.option = name; this.values = []; }
	Opt.prototype.value = function(v) { this.values.push(v); };
	const fakeForm = { Flag: 'Flag', Value: 'Value', DynamicList: 'DynamicList', ListValue: 'ListValue', NamedSection: 'NamedSection',
		Map: function(cfg) { this.config = cfg; this.section = (type, sid, stype) => { assert.deepStrictEqual([ type, sid, stype ], [ 'NamedSection', 'setup', 'apmond' ]);
			return { tab: (t) => tabs.push(t), taboption: (tab, type, name) => { const o = new Opt(type, name); o.tab = tab; opts.push(o); return o; } }; };
			this.render = () => Promise.resolve({ children: [], firstChild: null, insertBefore: function(n) { this.children.unshift(n); } }); } };
	fakeForm.ListValue = function() {}; fakeForm.ListValue.prototype.write = function() { return 'written'; };
	const fakeDom = { content: (el, c) => { el.children = c == null ? [] : [ c ]; } };
	const superCalls = [];
	const fakeView = { extend: (o) => { o.super = (name, args) => { superCalls.push(name); return Promise.resolve('saved'); }; return o; } };
	const noticeOf = (node) => node.children[0].children;
	for (const seed of [ undefined, 'my secret' ]) {
		opts.length = 0;
		const sv2 = loadView('settings', { form: fakeForm, dom: fakeDom, view: fakeView, uci: { get: () => seed, load: () => Promise.resolve() } });
		const node = await sv2.render();
		assert.strictEqual(node.children.length, 3);
		assert.strictEqual(noticeOf(node).length, seed ? 0 : 1);
		if (!seed) {
			const t = text(noticeOf(node)[0]);
			assert.ok(t.includes('The built-in default passphrase is in use. Make ApmonD more secure by adding your own passphrase, the same on every node.') && !/insecure/i.test(t), t);
		}
	}
	ok('settings: default passphrase notice only while apmon_seed is unset');
	// the notice follows the saved config after Save / Save & Apply, without a page reload
	let saved;
	opts.length = 0;
	const sv3 = loadView('settings', { form: fakeForm, dom: fakeDom, view: fakeView, uci: { get: (c, s, o) => (c === 'apmond' && s === 'setup' && o === 'apmon_seed') ? saved : undefined, load: () => Promise.resolve() } });
	const n3 = await sv3.render();
	assert.strictEqual(noticeOf(n3).length, 1);
	saved = 'my secret';
	assert.strictEqual(await sv3.handleSave({}), 'saved');
	assert.strictEqual(noticeOf(n3).length, 0, 'notice removed once a passphrase is saved');
	saved = '';
	await sv3.handleSave({});
	assert.strictEqual(noticeOf(n3).length, 1, 'notice back when the passphrase is cleared');
	saved = '--__';
	await sv3.handleSave({});
	assert.strictEqual(noticeOf(n3).length, 1);
	assert.deepStrictEqual(superCalls.slice(-3), [ 'handleSave', 'handleSave', 'handleSave' ]);
	ok('settings: notice re-evaluated after save, gone when a passphrase is saved, back when cleared');
	const cfgOpts = (fs.readFileSync(path.join(__dirname, 'samples/apmond.config'), 'utf8').match(/#(?:option|list) (\w+)/g) || []).map((x) => x.split(' ')[1]);
	const have = opts.map((o) => o.option);
	assert.deepStrictEqual([ ...have ].sort(), [ ...new Set(cfgOpts.concat([ 'apmon_seed' ])) ].sort()); ok('settings: every option in /etc/config/apmond is on the page (' + have.length + ')');
	assert.deepStrictEqual(opts.find((o) => o.option === 'debuglevel').values, [ '0', '1', '2', '3' ]);
	assert.deepStrictEqual(opts.find((o) => o.option === 'router_detect').values, [ '1', '0', '2' ]);
	assert.ok(opts.find((o) => o.option === 'apmon_seed').password); ok('settings: debuglevel, router_detect choices, password field');
	const dl = opts.find((o) => o.option === 'debuglevel');
	let removed = 0; dl.remove = () => { removed++; };
	dl.cfgvalue = () => undefined; assert.strictEqual(dl.write('setup', '1'), undefined);
	dl.cfgvalue = () => '3'; dl.write('setup', '1'); assert.strictEqual(removed, 1);
	assert.strictEqual(dl.write('setup', '2'), 'written'); ok('settings: choosing a default leaves the option unset (or removes it)');

	// Version: luci-app-apmond's own version strings, the installed apmond version (apmond -v), the page footer
	const ver = loadView('version');
	const vsrc = fs.readFileSync(path.join(VIEWS, 'version.js'), 'utf8');
	assert.ok(/^var last_version = '[^']+';$/m.test(vsrc) && /^var version = '[^']+';$/m.test(vsrc)); ok('version: last_version and version are one line each in version.js');
	assert.strictEqual(ver.version, '1.0.1~be7a'); assert.strictEqual(ver.last_version, '1.0.0'); ok('version: 1.0.1~be7a, previous 1.0.0');
	const vre = /^\d+\.\d+\.\d+(~be7a)?$/;
	assert.ok(vre.test(ver.version) && vre.test(ver.last_version)); ok('version: x.y.z or x.y.z~be7a, as apmond and mesh11sd');
	const vnum = (v) => v.replace('~be7a', '').split('.').map(Number);
	const cmpv = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
	assert.ok(cmpv(vnum(ver.version), vnum(ver.last_version)) > 0); ok('version: newer than last_version');
	const head = fs.readFileSync(path.join(ROOT, 'ChangeLog'), 'utf8').split('\n')[0];
	assert.strictEqual(head, 'luci-app-apmond (' + ver.version + ')'); ok('version: ChangeLog heading matches (' + head + ')');
	assert.strictEqual(ver.parseApmondVersion('apmond version 1.0.1~be7a\n'), '1.0.1~be7a');
	assert.strictEqual(ver.parseApmondVersion('apmond version 1.0.2'), '1.0.2'); ok('version: apmond -v output parsed');
	const unknown100 = 'Unknown option [ -v ]\n\n  Usage: apmond [option] [argument...]\n\n  option: version\n\tPrint the version of apmond\n';
	[ '', null, undefined, unknown100, 'garbage' ].forEach((x) => assert.strictEqual(ver.parseApmondVersion(x), null)); ok('version: apmond 1.0.0 (no -v), empty or failed output gives null');
	const vcalls = [];
	const vok = loadView('version', { fs: { exec_direct: (cmd, args) => { vcalls.push(cmd + ' ' + args.join(' ')); return Promise.resolve('apmond version 1.0.1~be7a\n'); } } });
	assert.strictEqual(await vok.fetchApmondVersion(), '1.0.1~be7a'); assert.deepStrictEqual(vcalls, [ '/usr/sbin/apmond -v' ]); ok('version: installed apmond version read with "apmond -v"');
	const vfail = loadView('version', { fs: { exec_direct: () => Promise.reject(new Error('exit 1')) } });
	assert.strictEqual(await vfail.fetchApmondVersion(), null);
	const v100 = loadView('version', { fs: { exec_direct: () => Promise.resolve(unknown100) } });
	assert.strictEqual(await v100.fetchApmondVersion(), null); ok('version: a failed or 1.0.0 -v call resolves to null, no throw');
	assert.strictEqual(ver.footerText(), 'luci-app-apmond 1.0.1~be7a');
	assert.strictEqual(ver.footerText('1.0.1~be7a'), 'luci-app-apmond 1.0.1~be7a, apmond 1.0.1~be7a');
	assert.strictEqual(ver.footerText(null), 'luci-app-apmond 1.0.1~be7a, apmond unknown'); ok('version: footer text, apmond unknown when it cannot be read');
	const tick = () => new Promise((r) => setTimeout(r, 0));
	for (const [ fsFake, want ] of [ [ vok, 'apmond 1.0.1~be7a' ], [ v100, 'apmond unknown' ], [ vfail, 'apmond unknown' ] ]) {
		const fv = loadView('version', { fs: { exec_direct: (c, a) => fsFake === vok ? Promise.resolve('apmond version 1.0.1~be7a\n') : fsFake === v100 ? Promise.resolve(unknown100) : Promise.reject(new Error('x')) }, dom: fakeDom });
		const f = fv.footer();
		assert.strictEqual(f.attrs['class'], 'apmond-version'); assert.strictEqual(text(f), 'luci-app-apmond 1.0.1~be7a');
		await tick(); await tick();
		assert.strictEqual(text(f), 'luci-app-apmond 1.0.1~be7a, ' + want);
	}
	ok('version: footer filled in with the apmond version, or unknown');
	const hasFooter = (n) => find(n, 'div').some((d) => d.attrs && d.attrs['class'] === 'apmond-version');
	const fakeFs = { exec_direct: () => Promise.resolve('') };
	assert.ok(hasFooter(loadView('status', { fs: fakeFs }).render(''))); ok('version: footer on the Status page');
	assert.ok(hasFooter(loadView('accesspoints', { fs: fakeFs }).render({ collector: false, nodes: [] }))); ok('version: footer on the Access points page');
	assert.ok(hasFooter(loadView('log', { fs: fakeFs, ui: { createHandlerFn: () => null } }).render(''))); ok('version: footer on the Log page');
	opts.length = 0;
	const svf = await loadView('settings', { form: fakeForm, dom: fakeDom, view: fakeView, uci: { get: () => 'x', load: () => Promise.resolve() } }).render();
	assert.ok(hasFooter(svf)); ok('version: footer on the Settings page');
	assert.ok(!fs.readFileSync(path.join(ROOT, 'root/usr/share/luci/menu.d/luci-app-apmond.json'), 'utf8').includes('apmond/version')); ok('version: version.js is a module, not a menu page');

	console.log('\nResult: ' + pass + ' passed');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
