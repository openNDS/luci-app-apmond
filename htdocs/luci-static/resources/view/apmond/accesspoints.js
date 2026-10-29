'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require view.apmond.common as common';

/*
 * ApmonD access points: "ubus call apmond nodes" on the collector, every node that has
 * reported with its radios and clients, the collector first. A sender has no node list; it
 * shows its own status line and a link to this page on the collector.
 *
 * Node rows: state ok / late / lost from the collector; late and lost rows are greyed and a
 * lost node can be forgotten. Client rows: state active / stale; stale clients (gone from their
 * node's report, kept for client_stale_timeout) are greyed and can be forgotten.
 */

/* node macs whose client table is open, kept across refreshes */
var expanded = {};

var GREY = 'opacity:0.5';

/*
 * Fixed column widths (percent, each set sums to 100) with table-layout: fixed, so every node's
 * client table lines up with the others. In the narrow (mobile) theme layout the data-title
 * labels are shown instead.
 */
var NODE_COLS = [ 10, 11, 14, 10, 11, 9, 9, 8, 7, 5, 6 ];
var CLIENT_COLS = [ 12, 13, 5, 8, 11, 10, 10, 9, 9, 8, 5 ];
var CELL_STYLE = 'overflow-wrap:anywhere;word-break:break-word';
var HEAD_STYLE = 'overflow-wrap:normal;word-break:normal';

return view.extend({
	/* a th or td with a fixed width, labelled for the mobile layout */
	cell: function(tag, width, title, content) {
		var style = CELL_STYLE;
		var attrs;

		if (tag == 'th') {
			style = HEAD_STYLE;
		}

		attrs = { 'class': tag, 'style': 'width:' + width + '%;' + style };
		if (title != null) {
			attrs['data-title'] = title;
		}

		return E(tag, attrs, [ content ]);
	},

	/*
	 * A table with fixed column widths. rows: { cells: [ ... ], grey: bool }, or
	 * { detail: <tr> } for a full width row.
	 */
	fixedTable: function(widths, titles, rows) {
		var self = this;
		var head = E('tr', { 'class': 'tr table-titles' }, titles.map(function(t, i) {
			return self.cell('th', widths[i], null, t);
		}));

		return E('table', { 'class': 'table', 'style': 'table-layout:fixed;width:100%' }, [ head ].concat(rows.map(function(r) {
			var attrs = { 'class': 'tr' };

			if (r.detail) {
				return r.detail;
			}
			if (r.grey) {
				attrs.style = GREY;
			}

			return E('tr', attrs, r.cells.map(function(v, i) {
				return self.cell('td', widths[i], titles[i], v);
			}));
		})));
	},

	/* a Forget button; after forgetting, the page data is fetched again */
	forgetButton: function(what, mac) {
		var self = this;

		return E('button', {
			'class': 'btn cbi-button cbi-button-remove',
			'title': _('Remove it from the collector now. A node that still reports comes back.'),
			'click': ui.createHandlerFn(this, function() {
				var call;

				if (what == 'node') {
					call = common.forgetNode(mac);
				}
				else {
					call = common.forgetClient(mac);
				}

				return call.then(function() {
					return self.refresh();
				}).catch(function(e) {
					ui.addNotification(null, E('p', {}, [ _('Could not forget %s: %s').format(mac, e.message || e) ]), 'error');
				});
			})
		}, [ _('Forget') ]);
	},

	/* "1.2.3.4/24" lines, or "-" */
	renderIPv4: function(v) {
		var addrs = common.parseIPv4(v);
		var out = [];

		if (!addrs.length) {
			return '-';
		}

		addrs.forEach(function(a, i) {
			if (i) {
				out.push(E('br'));
			}
			out.push(a);
		});

		return E('span', {}, out);
	},

	/*
	 * ULA cell: a link to that node's Access points page, in a new window; "-" when it has
	 * none. This node's own ULA is plain text: a link would only open this page again.
	 */
	renderULA: function(v, own) {
		var ula = common.parseULA(v);

		if (!ula) {
			return '-';
		}
		if (own) {
			return ula;
		}
		return common.link(common.nodeURL(ula, 'accesspoints'), ula);
	},

	/* "ok, 12s ago" with the report date as tooltip; restart_needed and default passphrase marked */
	renderState: function(n) {
		var label = '%s, %s'.format(this.stateLabel(n.state), common.formatAge(n.age_s));
		var title = _('Last report: %s. Reports: %s, lost: %s').format(
			common.formatDate(n.last_report_date), common.text(n.reports), common.text(n.lost_reports));

		return E('span', { 'title': title }, [ label ]);
	},

	stateLabel: function(s) {
		if (s == 'ok') {
			return _('ok');
		}
		if (s == 'late') {
			return _('late');
		}
		if (s == 'lost') {
			return _('lost');
		}
		if (s == 'active') {
			return _('active');
		}
		if (s == 'stale') {
			return _('stale');
		}
		return common.text(s);
	},

	/* package version (build commit), in red with a note when the node needs a restart */
	renderVersion: function(n) {
		var v = n.package_version || n.apmond_version;
		var title = '';

		if (n.build_commit) {
			title = _('Build commit %s').format(n.build_commit);
		}

		if (n.restart_needed === true) {
			return E('span', {
				'style': 'color:#c00;font-weight:bold',
				'title': _('The apmond binary was replaced; restart apmond on this node.')
			}, [ common.text(v) + ' ' + _('(restart needed)') ]);
		}

		return E('span', { 'title': title }, [ common.text(v) ]);
	},

	renderLoad: function(v) {
		if (!Array.isArray(v)) {
			return '-';
		}
		return v.map(function(l) {
			return common.text(l);
		}).join(' / ');
	},

	/* one line per radio: "phy0: channel 1 (2412 MHz), HT20, 20 dBm: House-6873 (VLAN 10), guest-6873 (VLAN 20)" */
	renderRadios: function(radios) {
		var lines = [];

		if (!Array.isArray(radios) || !radios.length) {
			return '';
		}

		radios.forEach(function(r) {
			var aps = [];
			var parts = [];

			if (r.channel != null) {
				parts.push(_('channel %s').format(r.channel));
			}
			if (r.frequency_mhz != null) {
				parts.push('%s MHz'.format(r.frequency_mhz));
			}
			if (r.htmode) {
				parts.push(r.htmode);
			}
			else if (r.width_mhz != null) {
				parts.push('%s MHz'.format(r.width_mhz));
			}
			if (r.txpower_dbm != null) {
				parts.push('%s dBm'.format(r.txpower_dbm));
			}

			(r.aps || []).forEach(function(ap) {
				var t = '%s@%s'.format(common.text(ap.ssid), common.text(ap.ifname));

				t = t + ' (' + _('VLAN') + ' ' + common.text(ap.vlan);
				if (ap.vxlan != null) {
					t = t + ', ' + common.formatVxlan(ap.vxlan);
				}
				t = t + ')';
				aps.push(t);
			});

			if (lines.length) {
				lines.push(E('br'));
			}
			lines.push(E('strong', {}, [ common.text(r.phy) + ': ' ]));
			lines.push(parts.join(', '));
			if (aps.length) {
				lines.push(' \u2014 ' + aps.join(', '));
			}
		});

		return E('p', { 'style': 'margin:0.5em 0' }, lines);
	},

	/* the cells of one client row; nested under a node, so without the node column */
	clientCells: function(c) {
		var rx = '-';
		var tx = '-';
		var connected = '-';
		var forget = '';

		if (c.kind == 'wifi') {
			tx = common.formatKbps(c.tx_bitrate_kbps);
			rx = common.formatKbps(c.rx_bitrate_kbps);
			connected = common.formatDuration(c.connected_s);
		}
		else {
			tx = common.formatMbps(c.speed_mbps);
			rx = tx;
		}

		if (c.state == 'stale') {
			forget = this.forgetButton('client', c.client_mac);
		}

		return [
			c.client_mac,
			common.formatWhere(c),
			common.text(c.vlan),
			common.formatVxlan(c.vxlan),
			common.renderSignal(c),
			tx,
			rx,
			common.formatBytes(c.rx_bytes),
			common.formatBytes(c.tx_bytes),
			E('span', { 'title': common.formatDate(c.last_seen_date) }, [
				'%s, %s'.format(this.stateLabel(c.state), common.formatAge(c.last_seen_age_s))
			]),
			forget
		];
	},

	renderClients: function(node) {
		var self = this;
		var clients = node.clients || [];
		var rows;

		if (!clients.length) {
			return E('em', {}, [ _('No clients') ]);
		}

		rows = clients.map(function(c) {
			return {
				cells: self.clientCells(c),
				grey: (c.state == 'stale')
			};
		});

		return this.fixedTable(CLIENT_COLS, [
			_('Client MAC'), _('SSID@interface or port@bridge'), _('VLAN'), _('VXLAN'), _('Signal'),
			_('TX bitrate'), _('RX bitrate'), _('RX bytes'), _('TX bytes'), _('Last seen'), ' '
		], rows);
	},

	renderNodes: function(nodes, ownId) {
		var self = this;
		var rows = [];

		nodes.forEach(function(n) {
			var own = (n.node_mac == ownId);
			var open = !!expanded[n.node_mac];
			var detailStyle = null;
			var detail;
			var btn;
			var forget = '';
			var clientCount = n.client_count;

			if (!open) {
				detailStyle = 'display:none';
			}

			detail = E('tr', { 'class': 'tr', 'style': detailStyle }, [
				E('td', { 'class': 'td', 'colspan': String(NODE_COLS.length), 'style': 'flex:1 1 100%' }, [
					self.renderRadios(n.radios),
					self.renderClients(n)
				])
			]);

			btn = E('button', {
				'class': 'btn cbi-button',
				'click': function(ev) {
					expanded[n.node_mac] = !expanded[n.node_mac];
					if (expanded[n.node_mac]) {
						detail.style.display = '';
						ev.target.firstChild.data = _('Hide clients');
					}
					else {
						detail.style.display = 'none';
						ev.target.firstChild.data = _('Show clients');
					}
				}
			}, [ open ? _('Hide clients') : _('Show clients') ]);

			if (n.state == 'lost' && !own) {
				forget = self.forgetButton('node', n.node_mac);
			}

			if (clientCount == null) {
				clientCount = (n.clients || []).length;
			}

			rows.push({
				cells: [
					E('span', { 'title': common.text(n.model) }, [ common.text(n.hostname) ]),
					n.node_mac,
					self.renderULA(n.node_ula, own),
					self.renderIPv4(n.ipv4_addresses),
					self.renderState(n),
					self.renderVersion(n),
					common.text(n.openwrt_release),
					common.formatDuration(n.uptime_s),
					common.formatKiB(n.free_ram_kb),
					String(clientCount),
					E('span', {}, [ btn, ' ', forget ])
				],
				grey: (n.state != null && n.state != 'ok')
			});
			rows.push({ detail: detail });
		});

		return this.fixedTable(NODE_COLS, [
			_('Device'), _('MAC address'), _('ULA'), _('IPv4 address'), _('State'), _('apmond'),
			_('Release'), _('Uptime'), _('Free RAM'), _('Clients'), ' '
		], rows);
	},

	/* the nodes that use the built-in default passphrase, for a warning on the collector */
	defaultPassphraseNodes: function(nodes) {
		return nodes.filter(function(n) {
			return n.default_passphrase === true;
		}).map(function(n) {
			return common.text(n.hostname);
		});
	},

	/* resolves to { st, nodes } */
	fetchData: function() {
		return Promise.all([ common.getStatus(), common.getNodes() ]).then(function(res) {
			return { st: res[0], nodes: res[1] };
		});
	},

	renderData: function(data) {
		var st = data.st;
		var nodes = data.nodes;
		var out = [];
		var dflt;

		if (st == null) {
			return E('div', { 'class': 'alert-message error' },
				_('Could not read the ApmonD status. Is apmond installed, enabled and running?'));
		}

		if (st.role != 'collector') {
			out.push(common.senderNote(st, 'accesspoints'));
			return E('div', {}, out);
		}

		if (!nodes.length) {
			out.push(E('div', { 'class': 'alert-message notice' },
				_('This node is the collector. No reports have been received yet.')));
			return E('div', {}, out);
		}

		dflt = this.defaultPassphraseNodes(nodes);
		if (dflt.length) {
			out.push(E('div', { 'class': 'alert-message notice' }, [
				_('These nodes use the built-in default passphrase: %s. Set your own passphrase in Settings, the same on every node.').format(dflt.join(', '))
			]));
		}

		out.push(E('p', {}, [
			_('Access points that have reported to this node, the collector. Click "Show clients" for the radios and clients of an access point. Late and lost nodes and stale clients are greyed out.')
		]));
		out.push(this.renderNodes(nodes, st.id));

		return E('div', {}, out);
	},

	refresh: function() {
		var self = this;

		return this.fetchData().then(function(d) {
			dom.content(self.box, self.renderData(d));
		});
	},

	load: function() {
		return this.fetchData();
	},

	render: function(data) {
		var self = this;

		this.box = E('div', {}, [ this.renderData(data) ]);

		poll.add(function() {
			return self.refresh();
		}, 30);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ApmonD Access Points') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('Refreshed every 30 seconds.') ]),
			this.box,
			common.footer()
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
