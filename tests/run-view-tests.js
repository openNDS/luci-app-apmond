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
		view: { extend: (o) => o },
		form: {}, fs: {}, ui: {}, poll: { add: () => {} }, dom: { content: () => {} }, uci: {},
		L: { resolveDefault: (p, d) => Promise.resolve(p).catch(() => d) },
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
	assert.strictEqual(w.length, 5, w.join('\n')); ok('status: checksum, passphrase, storage, logging and protocol warnings');
	const brows = st.statusRows(b);
	[ 'checksum', 'installed_checksum', 'default_passphrase', 'log_mountpoint', 'logging', 'protocol_mismatch_nodes' ]
		.forEach((k) => assert.ok(brows.find((x) => x[0] === k)[3], k));
	assert.ok(!brows.find((x) => x[0] === 'checksum_warning')); ok('status: warning rows highlighted, warning keys not repeated in the table');
	assert.ok(st.statusWarnings(st.parseStatus('{"apmond_status":{"enabled":"1","daemon_running":"no"}}'))[0].includes('not running')); ok('status: enabled but not running warned');
	[ null, '', 'garbage', '[]', '{"x":1}' ].forEach((t) => assert.strictEqual(st.parseStatus(t), null));
	ok('status: empty or bad output gives null');
	assert.ok(text(st.renderStatus(sample('status_router.json'))).includes('router')); ok('status: renderStatus renders');
	assert.ok(text(st.renderStatus(JSON.stringify(bad))).includes('Make ApmonD more secure by setting option apmon_seed')); ok('status: renderStatus shows warnings');
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
	let d = await mk({ show_ap_data: sample('show_ap_data_all.json') }).fetchData();
	assert.ok(d.collector && d.nodes.length === 2); ok('ap: fetchData on the collector');
	d = await mk({ show_ap_data: '', get_ap_data: sample('get_ap_data_peer.json') }).fetchData();
	assert.ok(!d.collector && d.nodes.length === 1); ok('ap: fetchData on a peer falls back to get_ap_data');
	assert.ok(text(ap.renderData(d)).includes('not the collector')); ok('ap: peer note shown');
	assert.ok(text(ap.renderData({ collector: false, nodes: [] })).includes('No access point data')); ok('ap: no data message');
	const acl = JSON.parse(fs.readFileSync(path.join(ROOT, 'root/usr/share/rpcd/acl.d/luci-app-apmond.json')))['luci-app-apmond'].read.file;
	const st2 = loadView('status', { fs: { exec_direct: (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(''); } } });
	const lg = loadView('log', { fs: { exec_direct: (cmd, args) => { calls.push(cmd + ' ' + args.join(' ')); return Promise.resolve(''); } } });
	await st2.fetchStatus(); await lg.fetchLog();
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
	for (const seed of [ undefined, 'my secret' ]) {
		opts.length = 0;
		const sv2 = loadView('settings', { form: fakeForm, uci: { get: () => seed, load: () => Promise.resolve() } });
		const node = await sv2.render();
		assert.strictEqual(node.children.length, seed ? 0 : 1);
		if (!seed) {
			const t = text(node.children[0]);
			assert.ok(t.includes('The built-in default passphrase is in use. Make ApmonD more secure by adding your own passphrase, the same on every node.') && !/insecure/i.test(t), t);
		}
	}
	ok('settings: default passphrase notice only while apmon_seed is unset');
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

	console.log('\nResult: ' + pass + ' passed');
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
