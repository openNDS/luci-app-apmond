'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require dom';

/*
 * ApmonD access points.
 *
 * On the collector "apmond show_ap_data all" prints every stored report merged into one
 * JSON object; on any node "apmond get_ap_data" prints this node's own report:
 *
 *   "System@<mac>": {
 *     "Device": ..., "Description": ..., "Release": ..., "phy": { ... },
 *     "node_status": { "device_mac", "uptime_seconds", "load_average_1min", "free_ram_kb", ... },
 *     "clients@<mac>": {
 *       "<SSID>@<iface>" or "<port>@<bridge>": {
 *         "<client mac>": { "rx_bytes", "tx_bytes", "signal_avg", "tx_bitrate", "rx_bitrate",
 *                           "connected_time", "vlan", "stats_scope", ... }
 *       }
 *     }
 *   }
 *
 * Text values come from mesh11sd style output, with underscores for spaces ("72.2_MBit/s").
 */

var APMOND = '/usr/sbin/apmond';

/* node macs whose client table is open, kept across refreshes */
var expanded = {};

return view.extend({
	/* "72.2_MBit/s_MCS_7" -> "72.2 MBit/s MCS 7" */
	text: function(v) {
		return (v == null || v === '') ? '-' : String(v).replace(/_/g, ' ');
	},

	/* a JSON object from apmond output, or null when it is empty or not JSON */
	parseJSON: function(text) {
		var obj;

		if (text == null || String(text).trim() === '')
			return null;

		try {
			obj = JSON.parse(text);
		}
		catch (e) {
			return null;
		}

		return (obj && typeof(obj) == 'object' && !Array.isArray(obj)) ? obj : null;
	},

	formatBytes: function(v) {
		var n = parseInt(v, 10), units = [ 'B', 'KiB', 'MiB', 'GiB', 'TiB' ], i = 0;

		if (isNaN(n))
			return this.text(v);

		while (n >= 1024 && i < units.length - 1) {
			n /= 1024;
			i++;
		}

		return (i ? n.toFixed(2) : String(n)) + ' ' + units[i];
	},

	/* free_ram_kb and similar: a KiB count, or text such as "unknown" */
	formatKiB: function(v) {
		var n = parseInt(v, 10);
		return isNaN(n) ? this.text(v) : this.formatBytes(n * 1024);
	},

	/* seconds (number, or text such as "4100_seconds") -> "1d 2h 3m 4s" */
	formatDuration: function(v) {
		var s = parseInt(v, 10), out = [];

		if (isNaN(s))
			return this.text(v);

		var d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;

		if (d) out.push(d + 'd');
		if (d || h) out.push(h + 'h');
		if (d || h || m) out.push(m + 'm');
		out.push((s % 60) + 's');

		return out.join(' ');
	},

	/* wired client speeds are plain Mbit/s numbers ("1000", "1000/100"), or "down" / "unknown" */
	formatBitrate: function(v) {
		if (v != null && /^[0-9]+(\/[0-9]+)*$/.test(String(v)))
			return String(v) + ' Mbit/s';
		return this.text(v);
	},

	/*
	 * Turn the apmond JSON into a list of nodes:
	 * [ { mac, device, release, uptime, load, free_ram_kb, version, clients: [ ... ] }, ... ]
	 */
	parseNodes: function(obj) {
		var nodes = [];

		if (obj == null)
			return nodes;

		Object.keys(obj).forEach(function(key) {
			if (key.indexOf('System@') != 0 || obj[key] == null || typeof(obj[key]) != 'object')
				return;

			var sys = obj[key],
			    mac = key.substr(7),
			    ns = sys.node_status || {},
			    groups = sys['clients@' + mac] || {},
			    clients = [];

			Object.keys(groups).forEach(function(where) {
				var group = groups[where];

				if (group == null || typeof(group) != 'object')
					return;

				Object.keys(group).forEach(function(cmac) {
					var c = group[cmac] || {};

					clients.push({
						mac: cmac,
						where: where,
						wired: (c.stats_scope != null || c.signal_avg == null),
						vlan: c.vlan,
						signal: c.signal_avg,
						tx_bitrate: c.tx_bitrate,
						rx_bitrate: c.rx_bitrate,
						rx_bytes: c.rx_bytes,
						tx_bytes: c.tx_bytes,
						per_port: (c.stats_scope == 'port'),
						connected_time: c.connected_time
					});
				});
			});

			nodes.push({
				mac: ns.device_mac || mac,
				device: sys.Device,
				release: sys.Description || sys.Release,
				uptime: ns.uptime_seconds,
				load: [ ns.load_average_1min, ns.load_average_5min, ns.load_average_15min ],
				free_ram_kb: ns.free_ram_kb,
				version: ns.apmond_version,
				clients: clients
			});
		});

		return nodes;
	},

	renderClients: function(node) {
		var self = this;

		if (!node.clients.length)
			return E('em', {}, [ _('No clients') ]);

		return E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('MAC address') ]),
				E('th', { 'class': 'th' }, [ _('SSID@interface or port@bridge') ]),
				E('th', { 'class': 'th' }, [ _('VLAN') ]),
				E('th', { 'class': 'th' }, [ _('Signal') ]),
				E('th', { 'class': 'th' }, [ _('TX bitrate') ]),
				E('th', { 'class': 'th' }, [ _('RX bitrate') ]),
				E('th', { 'class': 'th' }, [ _('RX bytes') ]),
				E('th', { 'class': 'th' }, [ _('TX bytes') ]),
				E('th', { 'class': 'th' }, [ _('Connected') ])
			])
		].concat(node.clients.map(function(c) {
			var port = c.per_port ? ' ' + _('(per port)') : '';

			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ c.mac ]),
				E('td', { 'class': 'td' }, [ self.text(c.where) ]),
				E('td', { 'class': 'td' }, [ self.text(c.vlan) ]),
				E('td', { 'class': 'td' }, [ c.wired ? '-' : self.text(c.signal) ]),
				E('td', { 'class': 'td' }, [ c.wired ? self.formatBitrate(c.tx_bitrate) : self.text(c.tx_bitrate) ]),
				E('td', { 'class': 'td' }, [ c.wired ? self.formatBitrate(c.rx_bitrate) : self.text(c.rx_bitrate) ]),
				E('td', { 'class': 'td' }, [ self.formatBytes(c.rx_bytes) + port ]),
				E('td', { 'class': 'td' }, [ self.formatBytes(c.tx_bytes) + port ]),
				E('td', { 'class': 'td' }, [ c.connected_time != null ? self.formatDuration(c.connected_time) : '-' ])
			]);
		})));
	},

	renderNodes: function(nodes) {
		var self = this,
		    rows = [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('Device') ]),
				E('th', { 'class': 'th' }, [ _('MAC address') ]),
				E('th', { 'class': 'th' }, [ _('Release') ]),
				E('th', { 'class': 'th' }, [ _('Uptime') ]),
				E('th', { 'class': 'th' }, [ _('Load') ]),
				E('th', { 'class': 'th' }, [ _('Free RAM') ]),
				E('th', { 'class': 'th' }, [ _('Clients') ]),
				E('th', { 'class': 'th' }, [ ' ' ])
			])
		    ];

		nodes.forEach(function(n) {
			var open = !!expanded[n.mac],
			    detail = E('tr', { 'class': 'tr', 'style': open ? null : 'display:none' }, [
				E('td', { 'class': 'td', 'colspan': '8' }, [ self.renderClients(n) ])
			    ]),
			    btn = E('button', {
				'class': 'btn cbi-button',
				'click': function(ev) {
					expanded[n.mac] = !expanded[n.mac];
					detail.style.display = expanded[n.mac] ? '' : 'none';
					ev.target.firstChild.data = expanded[n.mac] ? _('Hide clients') : _('Show clients');
				}
			    }, [ open ? _('Hide clients') : _('Show clients') ]);

			rows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ self.text(n.device) ]),
				E('td', { 'class': 'td' }, [ n.mac ]),
				E('td', { 'class': 'td' }, [ self.text(n.release) ]),
				E('td', { 'class': 'td' }, [ self.formatDuration(n.uptime) ]),
				E('td', { 'class': 'td' }, [ n.load.map(function(l) { return self.text(l); }).join(' / ') ]),
				E('td', { 'class': 'td' }, [ self.formatKiB(n.free_ram_kb) ]),
				E('td', { 'class': 'td' }, [ String(n.clients.length) ]),
				E('td', { 'class': 'td' }, [ btn ])
			]));
			rows.push(detail);
		});

		return E('table', { 'class': 'table' }, rows);
	},

	/*
	 * Fetch the data: show_ap_data all on the collector; when that gives no access points
	 * (a peer, or nothing received yet) get_ap_data for this node only.
	 * Resolves to { collector: bool, nodes: [ ... ] }.
	 */
	fetchData: function() {
		var self = this;

		return L.resolveDefault(fs.exec_direct(APMOND, [ 'show_ap_data', 'all' ]), null).then(function(all) {
			var nodes = self.parseNodes(self.parseJSON(all));

			if (nodes.length)
				return { collector: true, nodes: nodes };

			return L.resolveDefault(fs.exec_direct(APMOND, [ 'get_ap_data' ]), null).then(function(own) {
				return { collector: false, nodes: self.parseNodes(self.parseJSON(own)) };
			});
		});
	},

	renderData: function(data) {
		var note;

		if (!data.nodes.length)
			return E('div', { 'class': 'alert-message warning' },
				_('No access point data. Is apmond installed and running?'));

		if (data.collector)
			note = _('Access points that have reported to this node, the collector. Click "Show clients" to see the clients of an access point.');
		else
			note = _('This node is not the collector, or the collector has not received any reports yet, so only this node is shown. The full list of access points is on the collector (the router).');

		return E('div', {}, [
			E('p', {}, [ note ]),
			this.renderNodes(data.nodes)
		]);
	},

	load: function() {
		return this.fetchData();
	},

	render: function(data) {
		var self = this,
		    box = E('div', {}, [ this.renderData(data) ]);

		poll.add(function() {
			return self.fetchData().then(function(d) {
				dom.content(box, self.renderData(d));
			});
		}, 30);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ApmonD Access Points') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('Refreshed every 30 seconds.') ]),
			box
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
