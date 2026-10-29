'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require view.apmond.common as common';

/*
 * ApmonD clients: "ubus call apmond clients {include_stale: true}" on the collector, one list
 * of every client of every access point, in node order then by MAC. Stale clients (gone from
 * their node's report, kept for client_stale_timeout) are greyed out and can be forgotten.
 * The filter box matches any text of a row (MAC, node, SSID, port, VLAN).
 */

var GREY = 'opacity:0.5';

/* the filter text, kept across refreshes */
var filterText = '';

return view.extend({
	forgetButton: function(mac) {
		var self = this;

		return E('button', {
			'class': 'btn cbi-button cbi-button-remove',
			'title': _('Remove it from the collector now. A client that is still connected comes back.'),
			'click': ui.createHandlerFn(this, function() {
				return common.forgetClient(mac).then(function() {
					return self.refresh();
				}).catch(function(e) {
					ui.addNotification(null, E('p', {}, [ _('Could not forget %s: %s').format(mac, e.message || e) ]), 'error');
				});
			})
		}, [ _('Forget') ]);
	},

	/* the text cells of one client, also used by the filter */
	clientTexts: function(c) {
		var rate = '-';

		if (c.kind == 'wifi') {
			rate = common.formatKbps(c.tx_bitrate_kbps) + ' / ' + common.formatKbps(c.rx_bitrate_kbps);
		}
		else {
			rate = common.formatLink(c.speed_mbps);
		}

		return [
			c.client_mac,
			common.text(c.node_hostname),
			common.text(c.node_mac),
			common.formatWhere(c),
			common.text(c.vlan),
			common.formatVxlan(c.vxlan),
			rate,
			'%s, %s'.format(c.state == 'stale' ? _('stale') : _('active'), common.formatAge(c.last_seen_age_s))
		];
	},

	/* does client c match the filter text? */
	matches: function(c, f) {
		var t;

		if (!f) {
			return true;
		}

		t = this.clientTexts(c).join(' ').toLowerCase();
		return t.indexOf(f.toLowerCase()) >= 0;
	},

	renderClients: function(clients) {
		var self = this;
		var shown;
		var rows;

		if (!clients.length) {
			return E('em', {}, [ _('No clients') ]);
		}

		shown = clients.filter(function(c) {
			return self.matches(c, filterText);
		});

		rows = shown.map(function(c) {
			var texts = self.clientTexts(c);
			var attrs = { 'class': 'tr' };
			var titles = [
				_('Client MAC'), _('Node'), _('Node MAC'), _('SSID@interface or port@bridge'),
				_('VLAN'), _('VXLAN'), _('TX / RX bitrate'), _('Last seen')
			];
			var cells;
			var forget = '';

			if (c.state == 'stale') {
				attrs.style = GREY;
				forget = self.forgetButton(c.client_mac);
			}

			cells = texts.map(function(t, i) {
				return E('td', { 'class': 'td', 'data-title': titles[i] }, [ t ]);
			});
			cells.splice(4, 0, E('td', { 'class': 'td', 'data-title': _('Signal') }, [ common.renderSignal(c) ]));
			cells.push(E('td', { 'class': 'td' }, [ forget ]));

			return E('tr', attrs, cells);
		});

		return E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ _('Client MAC') ]),
				E('th', { 'class': 'th' }, [ _('Node') ]),
				E('th', { 'class': 'th' }, [ _('Node MAC') ]),
				E('th', { 'class': 'th' }, [ _('SSID@interface or port@bridge') ]),
				E('th', { 'class': 'th' }, [ _('Signal') ]),
				E('th', { 'class': 'th' }, [ _('VLAN') ]),
				E('th', { 'class': 'th' }, [ _('VXLAN') ]),
				E('th', { 'class': 'th' }, [ _('TX / RX bitrate') ]),
				E('th', { 'class': 'th' }, [ _('Last seen') ]),
				E('th', { 'class': 'th' }, [ ' ' ])
			])
		].concat(rows));
	},

	/* resolves to { st, clients } */
	fetchData: function() {
		return Promise.all([ common.getStatus(), common.getClients() ]).then(function(res) {
			return { st: res[0], clients: res[1] };
		});
	},

	renderData: function(data) {
		if (data.st == null) {
			return E('div', { 'class': 'alert-message error' },
				_('Could not read the ApmonD status. Is apmond installed, enabled and running?'));
		}

		if (data.st.role != 'collector') {
			return E('div', {}, [ common.senderNote(data.st, 'clients') ]);
		}

		return this.renderClients(data.clients);
	},

	refresh: function() {
		var self = this;

		return this.fetchData().then(function(d) {
			self.data = d;
			dom.content(self.box, self.renderData(d));
		});
	},

	load: function() {
		return this.fetchData();
	},

	render: function(data) {
		var self = this;
		var filter = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': _('Filter'),
			'value': filterText,
			'keyup': function(ev) {
				filterText = ev.target.value;
				dom.content(self.box, self.renderData(self.data));
			}
		});

		this.data = data;
		this.box = E('div', {}, [ this.renderData(data) ]);

		poll.add(function() {
			return self.refresh();
		}, 30);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ApmonD Clients') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('Every client of every access point, refreshed every 30 seconds. Stale clients are greyed out.') ]),
			E('div', { 'style': 'margin-bottom:1em' }, [ filter ]),
			this.box,
			common.footer()
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
