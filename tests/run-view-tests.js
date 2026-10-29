#!/usr/bin/env node
// Load the LuCI views with small stand-ins for the LuCI runtime and run their rendering code
// against real apmond 2.0 ubus output (tests/samples). Usage: node tests/run-view-tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const VIEWS = path.join(ROOT, 'htdocs/luci-static/resources/view/apmond');
const SAMPLES = path.join(__dirname, 'samples');

function sample(f) {
	return fs.readFileSync(path.join(SAMPLES, f), 'utf8');
}

function json(f) {
	return JSON.parse(sample(f));
}

// LuCI String.prototype.format; the views use %s and %d
String.prototype.format = function() {
	let i = 0;
	const args = arguments;

	return this.replace(/%[sd]/g, function() {
		const v = args[i];

		i++;
		return String(v);
	});
};

// E() builds a plain tree: { tag, attrs, children }
function E(tag, attrs, children) {
	if (Array.isArray(attrs) || typeof attrs === 'string') {
		children = attrs;
		attrs = {};
	}
	if (children == null) {
		children = [];
	}
	if (!Array.isArray(children)) {
		children = [ children ];
	}
	return { tag: tag, attrs: attrs || {}, children: children, style: {}, firstChild: { data: '' } };
}

function text(n) {
	if (n == null || n === '') {
		return '';
	}
	if (typeof n !== 'object') {
		return String(n);
	}
	return n.children.map(text).join(' ');
}

function find(n, pred, out) {
	out = out || [];
	if (n && typeof n === 'object') {
		if (pred(n)) {
			out.push(n);
		}
		n.children.forEach(function(c) {
			find(c, pred, out);
		});
	}
	return out;
}

// the ubus answers the fake rpc gives, by method; calls are recorded
let ubus = {};
const calls = [];

const rpc = {
	declare: function(d) {
		return function() {
			const args = {};

			for (let i = 0; i < (d.params || []).length; i++) {
				args[d.params[i]] = arguments[i];
			}
			calls.push({ method: d.method, args: args });

			const r = ubus[d.method];
			if (r instanceof Error) {
				return Promise.reject(r);
			}
			if (r === undefined) {
				return Promise.reject(new Error('no answer'));
			}
			// rpc.declare's expect: unwrap the named key
			const key = Object.keys(d.expect || { '': 1 })[0];
			if (key && r && typeof r === 'object' && key in r) {
				return Promise.resolve(r[key]);
			}
			return Promise.resolve(r);
		};
	}
};

const L = {
	resolveDefault: function(p, d) {
		return Promise.resolve(p).catch(function() {
			return d;
		});
	},
	resource: function(p) {
		return '/luci-static/resources/' + p;
	},
	url: function(p) {
		return '/cgi-bin/luci/' + p;
	}
};

function loadFile(name, env) {
	const src = fs.readFileSync(path.join(VIEWS, name + '.js'), 'utf8');
	const names = Object.keys(env);

	return new Function(...names, src).apply(null, names.map(function(k) {
		return env[k];
	}));
}

function baseEnv() {
	return {
		view: { extend: (o) => o },
		baseclass: { extend: (o) => o },
		rpc: rpc,
		form: {},
		fs: {},
		ui: { createHandlerFn: (ctx, fn) => fn, addNotification: () => {} },
		poll: { add: () => {}, remove: () => {} },
		dom: { content: () => {} },
		uci: {},
		L: L,
		E: E,
		_: (s) => s
	};
}

function loadView(name, fakes) {
	const env = baseEnv();

	env.common = loadFile('common', baseEnv());
	return loadFile(name, Object.assign(env, fakes || {}));
}

let pass = 0;

function ok(msg) {
	pass++;
	console.log('PASS: ' + msg);
}

(async function() {
	const statusC = json('status_collector.json');
	const statusS = json('status_sender.json');
	const nodes = json('nodes_collector.json');
	const lost = json('nodes_lost_stale.json');
	const clients = json('clients_collector.json');
	let t;
	let v;

	// common
	const common = loadFile('common', baseEnv());
	assert.strictEqual(common.text(null), '-');
	assert.strictEqual(common.text(10), '10');
	ok('common: null (untagged VLAN) shows as -');
	assert.strictEqual(common.formatDate('Thu_Oct_29_22:19:32_GMT_2026'), 'Thu Oct 29 22:19:32 GMT 2026');
	ok('common: _date fields with spaces');
	assert.strictEqual(common.formatAge(16), '16s ago');
	assert.strictEqual(common.formatAge(400), '6m ago');
	assert.strictEqual(common.formatAge(10000), '2h ago');
	ok('common: ages as the apmond tables');
	assert.strictEqual(common.formatKbps(72200), '72.2 Mbit/s');
	assert.strictEqual(common.formatLink(100), 'Link 100 Mbit/s');
	assert.strictEqual(common.formatLink(null), '-');
	assert.strictEqual(common.formatVxlan({ vni: 42, device: 'vxlan42' }), 'vni 42 (vxlan42)');
	assert.strictEqual(common.formatVxlan(null), '-');
	ok('common: bitrates, wired link speed and vxlan');
	assert.strictEqual(common.formatWhere(clients.clients[0]), 'eth0.1@br-lan');
	assert.strictEqual(common.formatWhere(lost.nodes[1].clients[0]), 'House-f9d1@phy0-ap0');
	ok('common: port@bridge for wired, SSID@interface for Wi-Fi');
	assert.strictEqual(common.footerText(statusC), 'luci-app-apmond 2.0.0beta, apmond 2.0.0_beta-r14 (66a4b9e)');
	assert.strictEqual(common.footerText(null), 'luci-app-apmond 2.0.0beta, apmond unknown');
	ok('common: footer with package version and build commit');
	t = text(common.senderNote(statusS, 'accesspoints'));
	assert.ok(t.includes('Not a collector.'));
	v = find(common.senderNote(statusS, 'accesspoints'), (n) => n.tag === 'a');
	assert.strictEqual(v.length, 1);
	assert.ok(v[0].attrs.href.endsWith('//[fd46:cfe5:34c5:6ddd::1]/cgi-bin/luci/admin/services/apmond/accesspoints'));
	assert.strictEqual(common.senderNote(statusC, 'accesspoints'), null);
	ok('common: sender note links to the same page on the collector ULA');

	ubus = { status: statusC };
	assert.strictEqual((await common.getStatus()).role, 'collector');
	ubus = {};
	assert.strictEqual(await common.getStatus(), null);
	assert.deepStrictEqual(await common.getNodes(), []);
	ok('common: ubus errors give null / []');

	// Status
	const st = loadView('status');
	assert.deepStrictEqual(st.statusWarnings(statusC), []);
	assert.deepStrictEqual(st.statusNotes(statusC), [ 'The built-in default passphrase is in use. Set your own passphrase in Settings, the same on every node.' ]);
	ok('status: collector sample has the default passphrase note and no warnings');
	t = text(st.renderStatus(statusC));
	assert.ok(t.includes('2.0.0_beta-r14'));
	assert.ok(t.includes('3 (debug)'));
	assert.ok(t.includes('accepted: 129'));
	assert.ok(!t.includes('passphrase_warning'));
	ok('status: rendered with groups, debug level and collector counters');
	v = st.statusGroups(statusS).map((g) => g[0]);
	assert.deepStrictEqual(v, [ 'Daemon', 'Role and addresses', 'Reports' ]);
	ok('status: sender has no Collector group');
	v = Object.assign({}, statusC, { restart_needed: true, last_status: 401 });
	assert.strictEqual(st.statusWarnings(v).length, 2);
	ok('status: restart needed and rejected report are warnings');
	assert.ok(text(st.renderStatus(null)).includes('Could not read'));
	ok('status: no daemon');

	// Access points
	const ap = loadView('accesspoints');
	t = ap.renderData({ st: statusC, nodes: nodes.nodes });
	v = text(t);
	assert.ok(v.includes('OpenWrt-6873'));
	assert.ok(v.includes('OpenWrt-f9d1'));
	assert.ok(v.includes('192.168.10.173/24'));
	assert.ok(v.includes('eth0.1@br-lan'));
	assert.ok(v.includes('House-6873@phy0-ap0 (VLAN 10)'));
	assert.ok(v.includes('These nodes use the built-in default passphrase: OpenWrt-6873, OpenWrt-f9d1'));
	ok('access points: collector nodes, addresses, radios and clients');
	v = find(t, (n) => n.tag === 'tr' && text(n).includes('1c:86:0b:36:3f:dd') && n.children.length > 3)[0];
	v = v.children.map(text);
	assert.strictEqual(v[5], 'Link 100 Mbit/s');
	assert.strictEqual(v[6], '-');
	ok('access points: wired client shows Link speed in TX bitrate, RX bitrate -');
	v = find(t, (n) => n.tag === 'a').map((a) => a.attrs.href);
	assert.deepStrictEqual(v, [ 'https://[fd46:cfe5:34c5:6ddd:9683:c4ff:fe2e:f9d1]/cgi-bin/luci/admin/services/apmond/accesspoints' ]);
	ok('access points: only the other node\'s ULA is a link');
	v = find(t, (n) => n.tag === 'button').map(text);
	assert.ok(!v.includes('Forget'));
	ok('access points: no Forget while every node is ok and every client active');
	t = ap.renderData({ st: statusC, nodes: lost.nodes });
	v = find(t, (n) => n.tag === 'tr' && n.attrs.style === 'opacity:0.5');
	assert.strictEqual(v.length, 2);
	assert.ok(text(v[0]).includes('lost, 6m ago'));
	assert.ok(text(v[0]).includes('(restart needed)'));
	assert.ok(text(v[1]).includes('stale, 6m ago'));
	assert.ok(text(v[1]).includes('vni 42 (vxlan42)'));
	assert.ok(text(v[1]).includes('-58 dBm'));
	assert.ok(text(v[1]).includes('72.2 Mbit/s'));
	ok('access points: lost node and stale Wi-Fi client greyed, with VXLAN, signal and bitrate');
	v = find(t, (n) => n.tag === 'button' && text(n) === 'Forget');
	assert.strictEqual(v.length, 2);
	calls.length = 0;
	ubus = { forget: { removed_clients: 1 }, status: statusC, nodes: nodes };
	ap.box = E('div');
	await v[0].attrs.click();
	await v[1].attrs.click();
	assert.deepStrictEqual(calls.filter((c) => c.method === 'forget').map((c) => c.args), [
		{ node_mac: '94:83:c4:2e:f9:d1' }, { client_mac: 'aa:bb:cc:dd:ee:ff' }
	]);
	ok('access points: Forget calls ubus forget with node_mac / client_mac');
	t = ap.renderData({ st: statusS, nodes: [] });
	assert.ok(text(t).includes('Not a collector.'));
	ok('access points: sender page links to the collector');

	// Clients
	const cl = loadView('clients');
	t = cl.renderData({ st: statusC, clients: clients.clients });
	v = text(t);
	assert.ok(v.includes('1c:86:0b:36:3f:dd'));
	assert.ok(v.includes('OpenWrt-6873'));
	assert.ok(v.includes('Link 100 Mbit/s'));
	ok('clients: flat list with node hostname, wired speed as link speed');
	v = find(t, (n) => n.tag === 'td');
	assert.strictEqual(text(v[0]), '1c:86:0b:36:3f:dd');
	ok('clients: client MAC first');
	assert.ok(cl.matches(clients.clients[0], 'eth0.1'));
	assert.ok(!cl.matches(clients.clients[0], 'nomatch'));
	ok('clients: filter');
	assert.ok(text(cl.renderData({ st: statusS, clients: [] })).includes('Not a collector.'));
	ok('clients: sender page links to the collector');

	// Log
	const lg = loadView('log');
	assert.ok(lg.logText(sample('read_log.txt')).includes('accepted'));
	assert.ok(lg.logText(null).includes('Could not read'));
	assert.ok(lg.logText('').includes('empty'));
	ok('log: text, missing and empty');

	// ACL: only read_log is run
	const acl = JSON.parse(fs.readFileSync(path.join(ROOT, 'root/usr/share/rpcd/acl.d/luci-app-apmond.json'), 'utf8'))['luci-app-apmond'];
	assert.deepStrictEqual(Object.keys(acl.read.file), [ '/usr/sbin/apmond read_log' ]);
	assert.deepStrictEqual(acl.read.ubus.apmond, [ 'status', 'nodes', 'node', 'clients' ]);
	assert.deepStrictEqual(acl.write.ubus.apmond, [ 'forget' ]);
	ok('acl: ubus reads, forget write, read_log the only command');

	console.log('\n' + pass + ' passed');
})().catch(function(e) {
	console.error('FAIL:', e);
	process.exit(1);
});
