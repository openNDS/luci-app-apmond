'use strict';
'require baseclass';
'require rpc';
'require dom';

/*
 * Shared code of the luci-app-apmond views: the apmond ubus calls, value formatting and the
 * version footer. Not a page of its own (it is not in the menu); the views require it as
 * view.apmond.common.
 *
 * apmond 2.x is a C daemon with the ubus object "apmond" (see docs/PROTOCOL.md in openNDS/apmon).
 * The views call it through rpcd (rpc.declare), allowed by
 * /usr/share/rpcd/acl.d/luci-app-apmond.json. Nothing is run through a shell except
 * "apmond read_log" on the Log page.
 */

/* luci-app-apmond version, as apmond: the only place to change at a version bump */
var last_version = '1.0.1';
var version = '2.0.0beta';

var callStatus = rpc.declare({
	object: 'apmond',
	method: 'status',
	expect: { '': {} }
});

var callNodes = rpc.declare({
	object: 'apmond',
	method: 'nodes',
	expect: { 'nodes': [] }
});

var callClients = rpc.declare({
	object: 'apmond',
	method: 'clients',
	params: [ 'include_stale' ],
	expect: { 'clients': [] }
});

var callForgetNode = rpc.declare({
	object: 'apmond',
	method: 'forget',
	params: [ 'node_mac' ]
});

var callForgetClient = rpc.declare({
	object: 'apmond',
	method: 'forget',
	params: [ 'client_mac' ]
});

return baseclass.extend({
	version: version,
	last_version: last_version,

	/* resolves to the status object, or null when apmond is not running or not reachable */
	getStatus: function() {
		return L.resolveDefault(callStatus(), null).then(function(st) {
			if (st == null || typeof(st) != 'object' || st.version == null) {
				return null;
			}
			return st;
		});
	},

	/* resolves to the list of nodes ([] on a sender, or on any error) */
	getNodes: function() {
		return L.resolveDefault(callNodes(), []).then(function(list) {
			if (!Array.isArray(list)) {
				return [];
			}
			return list;
		});
	},

	/* resolves to the flat client list, stale clients included ([] on any error) */
	getClients: function() {
		return L.resolveDefault(callClients(true), []).then(function(list) {
			if (!Array.isArray(list)) {
				return [];
			}
			return list;
		});
	},

	forgetNode: function(mac) {
		return callForgetNode(mac);
	},

	forgetClient: function(mac) {
		return callForgetClient(mac);
	},

	/* "-" for null, undefined or "" (vlan null is untagged), else the value as text */
	text: function(v) {
		if (v == null || v === '') {
			return '-';
		}
		return String(v);
	},

	/* the _date fields, "Thu_Oct_29_15:47:00_GMT_2026" -> "Thu Oct 29 15:47:00 GMT 2026" */
	formatDate: function(v) {
		if (v == null || v === '') {
			return '-';
		}
		return String(v).replace(/_/g, ' ');
	},

	formatBytes: function(v) {
		var n = parseInt(v, 10);
		var units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ];
		var i = 0;

		if (isNaN(n)) {
			return '-';
		}

		while (n >= 1024 && i < units.length - 1) {
			n = n / 1024;
			i++;
		}

		if (i == 0) {
			return String(n) + ' ' + units[i];
		}
		return n.toFixed(2) + ' ' + units[i];
	},

	/* free_ram_kb and similar, a KiB count */
	formatKiB: function(v) {
		var n = parseInt(v, 10);

		if (isNaN(n)) {
			return '-';
		}
		return this.formatBytes(n * 1024);
	},

	/* seconds -> "1d 2h 3m 4s" */
	formatDuration: function(v) {
		var s = parseInt(v, 10);
		var d;
		var h;
		var m;
		var out = [];

		if (isNaN(s)) {
			return '-';
		}

		d = Math.floor(s / 86400);
		h = Math.floor(s / 3600) % 24;
		m = Math.floor(s / 60) % 60;

		if (d) {
			out.push(d + 'd');
		}
		if (d || h) {
			out.push(h + 'h');
		}
		if (d || h || m) {
			out.push(m + 'm');
		}
		out.push((s % 60) + 's');

		return out.join(' ');
	},

	/* an age in seconds -> "12s ago", "5m ago", "3h ago", "2d ago", as the apmond -t tables */
	formatAge: function(v) {
		var s = parseInt(v, 10);

		if (isNaN(s)) {
			return '-';
		}
		if (s < 0) {
			s = 0;
		}

		if (s < 120) {
			return _('%ss ago').format(s);
		}
		if (s < 7200) {
			return _('%sm ago').format(Math.floor(s / 60));
		}
		if (s < 172800) {
			return _('%sh ago').format(Math.floor(s / 3600));
		}
		return _('%sd ago').format(Math.floor(s / 86400));
	},

	/* tx/rx_bitrate_kbps -> "72.2 Mbit/s" */
	formatKbps: function(v) {
		var n = parseInt(v, 10);

		if (isNaN(n)) {
			return '-';
		}
		return (n / 1000).toFixed(1) + ' ' + _('Mbit/s');
	},

	/* wired speed_mbps -> "100 Mbit/s" */
	formatMbps: function(v) {
		var n = parseInt(v, 10);

		if (isNaN(n)) {
			return '-';
		}
		return String(n) + ' ' + _('Mbit/s');
	},

	/* vxlan { vni, device } -> "vni 42 (vxlan42)", or "-" */
	formatVxlan: function(v) {
		if (v == null || typeof(v) != 'object' || v.vni == null) {
			return '-';
		}
		if (v.device) {
			return _('vni %s (%s)').format(v.vni, v.device);
		}
		return _('vni %s').format(v.vni);
	},

	/* where a client is connected: "SSID@phy0-ap0" for Wi-Fi, "lan1@br-lan" for wired */
	formatWhere: function(c) {
		if (c.kind == 'wifi') {
			return '%s@%s'.format(this.text(c.ap_ssid), this.text(c.ap_ifname));
		}
		return '%s@%s'.format(this.text(c.port), this.text(c.bridge));
	},

	/* a ULA (fc00::/7), lower case, or null: only such a value is made a link */
	parseULA: function(v) {
		var s = '';

		if (typeof(v) == 'string') {
			s = v.toLowerCase();
		}
		if (!/^f[cd][0-9a-f]{2}:[0-9a-f:]+$/.test(s) || s.length > 39) {
			return null;
		}
		return s;
	},

	/* ipv4_addresses: the a.b.c.d or a.b.c.d/len strings of the array, [] if missing */
	parseIPv4: function(v) {
		if (!Array.isArray(v)) {
			return [];
		}

		return v.map(function(a) {
			return String(a);
		}).filter(function(a) {
			return /^[0-9]{1,3}(\.[0-9]{1,3}){3}(\/[0-9]{1,2})?$/.test(a);
		});
	},

	/*
	 * LuCI signal icon for a dBm value, with the quality mapping of the associated stations
	 * table in luci-mod-status: q = min((dBm + 110) / 70 * 100, 100)
	 */
	signalIcon: function(dbm) {
		var q = Math.min((dbm + 110) / 70 * 100, 100);

		if (q <= 0) {
			return 'icons/signal-000-000.svg';
		}
		if (q < 25) {
			return 'icons/signal-000-025.svg';
		}
		if (q < 50) {
			return 'icons/signal-025-050.svg';
		}
		if (q < 75) {
			return 'icons/signal-050-075.svg';
		}
		return 'icons/signal-075-100.svg';
	},

	/* signal cell: "-" for wired, else the LuCI icon and "-58 dBm" */
	renderSignal: function(c) {
		var dbm = parseInt(c.signal_avg_dbm, 10);
		var title;

		if (c.kind != 'wifi' || isNaN(dbm)) {
			return '-';
		}

		title = _('Signal') + ': ' + dbm + ' ' + _('dBm');
		if (c.ack_signal_avg_dbm != null) {
			title = title + ', ' + _('ACK signal') + ': ' + c.ack_signal_avg_dbm + ' ' + _('dBm');
		}

		return E('span', { 'style': 'white-space:nowrap', 'title': title }, [
			E('img', {
				'src': L.resource(this.signalIcon(dbm)),
				'alt': '',
				'style': 'width:20px;height:20px;vertical-align:middle'
			}),
			' ' + dbm + ' ' + _('dBm')
		]);
	},

	/* a page on another node, by its ULA, in the scheme this page was loaded with */
	nodeURL: function(ula, page) {
		var proto = 'https:';
		var path = '/cgi-bin/luci/admin/services/apmond/' + page;

		if (typeof(window) != 'undefined' && window.location && window.location.protocol) {
			proto = window.location.protocol;
		}
		if (L.url) {
			path = L.url('admin/services/apmond/' + page);
		}

		return proto + '//[' + ula + ']' + path;
	},

	/* a link opened in a new window */
	link: function(url, label) {
		return E('a', { 'href': url, 'target': '_blank', 'rel': 'noopener', 'title': url }, [ label ]);
	},

	/*
	 * The note on a sender: it holds no reports; the collector has them, with a link to the
	 * same page there. null on the collector.
	 */
	senderNote: function(st, page) {
		var ula;
		var parts;

		if (st == null || st.role == 'collector') {
			return null;
		}

		ula = this.parseULA(st.collector_ula);
		parts = [
			E('strong', {}, [ _('Not a collector.') ]),
			' ',
			_('This node reports to the collector, which has the data of every access point.')
		];

		if (ula) {
			parts.push(' ');
			parts.push(_('Open it on the collector'));
			parts.push(' ');
			parts.push(this.link(this.nodeURL(ula, page), ula));
			parts.push('.');
		}

		return E('div', { 'class': 'alert-message notice' }, [ E('p', {}, parts) ]);
	},

	/* the footer text for a status object (null while unknown) */
	footerText: function(st) {
		var t = _('luci-app-apmond %s').format(version);
		var v;

		if (st === undefined) {
			return t;
		}

		v = _('unknown');
		if (st && st.package_version) {
			v = st.package_version;
			if (st.build_commit) {
				v = v + ' (' + st.build_commit + ')';
			}
		}
		else if (st && st.version) {
			v = st.version;
		}

		return '%s, %s'.format(t, _('apmond %s').format(v));
	},

	/* a small line for the bottom of a page; the apmond version is filled in when it arrives */
	footer: function() {
		var self = this;
		var node = E('div', {
			'class': 'apmond-version',
			'style': 'text-align:right; font-size:smaller; opacity:0.7; margin-top:1em'
		}, [ this.footerText() ]);

		this.getStatus().then(function(st) {
			dom.content(node, self.footerText(st));
		});

		return node;
	}
});
