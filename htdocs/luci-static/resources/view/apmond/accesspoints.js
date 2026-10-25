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

/*
 * Fixed column widths (percent, each set sums to 100) with table-layout: fixed, so every node's
 * client table lines up with the others. Long values wrap inside their cell. In the narrow
 * (mobile) theme layout the rows are flex boxes, the widths do not apply and the data-title
 * labels are shown instead of the hidden title row.
 */
var CLIENT_COLS = [ 13, 15, 5, 13, 13, 13, 9, 9, 10 ];
var NODE_COLS = [ 15, 14, 21, 12, 13, 9, 6, 10 ];
var CELL_STYLE = 'overflow-wrap:anywhere;word-break:break-word';

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

	/* the leading dBm of "-29_[-35,_-31]_dBm" or "-29 [-34, -31] dBm", or null */
	parseSignal: function(v) {
		var m = (v == null) ? null : String(v).match(/^\s*(-?[0-9]+)(?![0-9.])/);
		return m ? parseInt(m[1], 10) : null;
	},

	/*
	 * LuCI signal icon for a dBm value, with the quality mapping and thresholds of the
	 * associated stations table in luci-mod-status (view/status/include/60_wifi.js):
	 * q = min((dBm + 110) / 70 * 100, 100)
	 */
	signalIcon: function(dbm) {
		var q = Math.min((dbm + 110) / 70 * 100, 100);

		if (q <= 0)
			return 'icons/signal-000-000.svg';
		else if (q < 25)
			return 'icons/signal-000-025.svg';
		else if (q < 50)
			return 'icons/signal-025-050.svg';
		else if (q < 75)
			return 'icons/signal-050-075.svg';
		else
			return 'icons/signal-075-100.svg';
	},

	/* per antenna values of "-38_[-44,_-39]_dBm" -> [ -44, -39 ], or [] */
	parseAntennas: function(v) {
		var m = (v == null) ? null : String(v).match(/\[([^\]]*)\]/);

		if (!m)
			return [];

		return m[1].replace(/_/g, ' ').split(',').map(function(x) {
			return x.trim();
		}).filter(function(x) {
			return /^-?[0-9]+$/.test(x);
		}).map(function(x) {
			return parseInt(x, 10);
		});
	},

	/* "Signal: -38 dBm (antennas: -44, -39 dBm)", or "Signal: -38 dBm" */
	signalTitle: function(v, dbm) {
		var ant = this.parseAntennas(v),
		    t = _('Signal') + ': ' + dbm + ' ' + _('dBm');

		if (ant.length)
			t += ' (' + _('antennas') + ': ' + ant.join(', ') + ' ' + _('dBm') + ')';

		return t;
	},

	/*
	 * signal cell content: '-' for wired; for wireless the LuCI signal icon and the leading
	 * value ("-38 dBm") on one line, details in the tooltip; the text as is if unparseable
	 */
	renderSignal: function(c) {
		var dbm;

		if (c.wired)
			return '-';

		dbm = this.parseSignal(c.signal);

		if (dbm == null)
			return this.text(c.signal);

		return E('span', { 'style': 'white-space:nowrap', 'title': this.signalTitle(c.signal, dbm) }, [
			E('img', { 'src': L.resource(this.signalIcon(dbm)), 'alt': '', 'style': 'width:20px;height:20px;vertical-align:middle' }),
			' ' + dbm + ' ' + _('dBm')
		]);
	},

	/* a th or td with a fixed width, wrapping long values, labelled for the mobile layout */
	cell: function(tag, width, title, content) {
		var attrs = { 'class': tag, 'style': 'width:' + width + '%;' + CELL_STYLE };

		if (title != null)
			attrs['data-title'] = title;

		return E(tag, attrs, [ content ]);
	},

	/* a table with fixed column widths: titles and rows of cell contents */
	fixedTable: function(widths, titles, rows) {
		var self = this;

		return E('table', { 'class': 'table', 'style': 'table-layout:fixed;width:100%' }, [
			E('tr', { 'class': 'tr table-titles' }, titles.map(function(t, i) {
				return self.cell('th', widths[i], null, t);
			}))
		].concat(rows.map(function(r) {
			if (r.detail)
				return r.detail;

			return E('tr', { 'class': 'tr' }, r.map(function(v, i) {
				return self.cell('td', widths[i], titles[i], v);
			}));
		})));
	},

	renderClients: function(node) {
		var self = this;

		if (!node.clients.length)
			return E('em', {}, [ _('No clients') ]);

		return this.fixedTable(CLIENT_COLS, [
			_('MAC address'), _('SSID@interface or port@bridge'), _('VLAN'), _('Signal'),
			_('TX bitrate'), _('RX bitrate'), _('RX bytes'), _('TX bytes'), _('Connected')
		], node.clients.map(function(c) {
			var port = c.per_port ? ' ' + _('(per port)') : '';

			return [
				c.mac,
				self.text(c.where),
				self.text(c.vlan),
				self.renderSignal(c),
				c.wired ? self.formatBitrate(c.tx_bitrate) : self.text(c.tx_bitrate),
				c.wired ? self.formatBitrate(c.rx_bitrate) : self.text(c.rx_bitrate),
				self.formatBytes(c.rx_bytes) + port,
				self.formatBytes(c.tx_bytes) + port,
				c.connected_time != null ? self.formatDuration(c.connected_time) : '-'
			];
		}));
	},

	renderNodes: function(nodes) {
		var self = this, rows = [];

		nodes.forEach(function(n) {
			var open = !!expanded[n.mac],
			    detail = E('tr', { 'class': 'tr', 'style': open ? null : 'display:none' }, [
				E('td', { 'class': 'td', 'colspan': '8', 'style': 'flex:1 1 100%' }, [ self.renderClients(n) ])
			    ]),
			    btn = E('button', {
				'class': 'btn cbi-button',
				'click': function(ev) {
					expanded[n.mac] = !expanded[n.mac];
					detail.style.display = expanded[n.mac] ? '' : 'none';
					ev.target.firstChild.data = expanded[n.mac] ? _('Hide clients') : _('Show clients');
				}
			    }, [ open ? _('Hide clients') : _('Show clients') ]);

			rows.push([
				self.text(n.device),
				n.mac,
				self.text(n.release),
				self.formatDuration(n.uptime),
				n.load.map(function(l) { return self.text(l); }).join(' / '),
				self.formatKiB(n.free_ram_kb),
				String(n.clients.length),
				btn
			]);
			rows.push({ detail: detail });
		});

		return this.fixedTable(NODE_COLS, [
			_('Device'), _('MAC address'), _('Release'), _('Uptime'), _('Load'), _('Free RAM'), _('Clients'), ' '
		], rows);
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
