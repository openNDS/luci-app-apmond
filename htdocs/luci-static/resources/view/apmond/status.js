'use strict';
'require view';
'require fs';
'require ui';
'require poll';
'require dom';

/*
 * ApmonD status: "apmond status" prints JSON, { "apmond_status": { key: value, ... } }.
 * Values are strings, except bridges and protocol_mismatch_nodes (arrays), and
 * ula_addresses and last_send (objects).
 */

var APMOND = '/usr/sbin/apmond';

/* display order and labels; keys not listed here are shown after these, under their own name */
var LABELS = [
	[ 'apmond_version', _('Version') ],
	[ 'apmond_protocol', _('Protocol') ],
	[ 'enabled', _('Enabled') ],
	[ 'daemon_running', _('Daemon running') ],
	[ 'daemon_pid', _('Daemon PID') ],
	[ 'role', _('Role') ],
	[ 'role_reason', _('Role reason') ],
	[ 'router_detect', _('Router detection') ],
	[ 'default_passphrase', _('Default passphrase in use') ],
	[ 'collector', _('Collector address') ],
	[ 'node_ula', _('Node address') ],
	[ 'ula_prefix', _('ULA prefix') ],
	[ 'ula_subnet', _('ULA subnet') ],
	[ 'ula_addresses', _('ULA addresses') ],
	[ 'device', _('Device') ],
	[ 'ap_mac_id', _('Access point ID') ],
	[ 'bridge_detect', _('Wired client bridges') ],
	[ 'bridges', _('Bridges scanned') ],
	[ 'interval_seconds', _('Report interval (s)') ],
	[ 'debuglevel', _('Debug level') ],
	[ 'last_send', _('Last report sent') ],
	[ 'access_points_with_data', _('Access points with data') ],
	[ 'protocol_mismatch_nodes', _('Protocol mismatch nodes') ],
	[ 'log_mountpoint', _('Log mountpoint') ],
	[ 'ap_data_dir', _('Access point data directory') ],
	[ 'log_file', _('Log file') ],
	[ 'logging', _('Logging') ],
	[ 'cgi_dir', _('CGI directory') ],
	[ 'runtime_dir', _('Runtime directory') ],
	[ 'checksum', _('Running checksum') ],
	[ 'installed_checksum', _('Installed checksum') ]
];

/* keys that only exist to carry a warning, shown in the warning box rather than the table */
var WARNING_KEYS = [ 'checksum_warning', 'passphrase_warning', 'storage_warning' ];

var ROUTER_DETECT = { '0': _('force router/collector'), '1': _('auto detect'), '2': _('force peer') };
var DEBUGLEVEL = { '0': _('errors'), '1': _('notices'), '2': _('info'), '3': _('debug') };

return view.extend({
	/* run "apmond status"; resolves to the raw text, or null if it could not be run */
	fetchStatus: function() {
		return L.resolveDefault(fs.exec_direct(APMOND, [ 'status' ]), null);
	},

	/* parse the status text: returns the apmond_status object, or null */
	parseStatus: function(text) {
		var obj;

		if (text == null || String(text).trim() === '')
			return null;

		try {
			obj = JSON.parse(text);
		}
		catch (e) {
			return null;
		}

		return (obj && typeof(obj.apmond_status) == 'object') ? obj.apmond_status : null;
	},

	/* list of warning strings for a parsed status */
	statusWarnings: function(st) {
		var w = [];

		WARNING_KEYS.forEach(function(k) {
			if (st[k])
				w.push(String(st[k]));
		});

		if (st.default_passphrase == 'yes' && !st.passphrase_warning)
			w.push(_('The default built-in passphrase is in use. Set your own passphrase in Settings, the same on every node.'));

		if (typeof(st.logging) == 'string' && st.logging.indexOf('DISABLED') == 0)
			w.push(st.logging);

		if (Array.isArray(st.protocol_mismatch_nodes) && st.protocol_mismatch_nodes.length)
			w.push(_('These nodes report a different apmond protocol, upgrade apmond on them: %s').format(st.protocol_mismatch_nodes.join(', ')));

		if (st.enabled == '1' && st.daemon_running == 'no')
			w.push(_('ApmonD is enabled but the daemon is not running.'));

		return w;
	},

	/* is this key a problem that should be highlighted in the table? */
	isWarningKey: function(st, key) {
		switch (key) {
		case 'checksum':
		case 'installed_checksum':
			return !!st.checksum_warning;
		case 'default_passphrase':
			return st.default_passphrase == 'yes';
		case 'log_mountpoint':
		case 'ap_data_dir':
			return !!st.storage_warning;
		case 'logging':
			return typeof(st.logging) == 'string' && st.logging.indexOf('DISABLED') == 0;
		case 'protocol_mismatch_nodes':
			return Array.isArray(st.protocol_mismatch_nodes) && st.protocol_mismatch_nodes.length > 0;
		case 'daemon_running':
			return st.enabled == '1' && st.daemon_running == 'no';
		}
		return false;
	},

	/* one value as display text */
	formatValue: function(key, v) {
		if (v == null)
			return '';

		if (key == 'router_detect' && ROUTER_DETECT[v])
			return '%s (%s)'.format(v, ROUTER_DETECT[v]);

		if (key == 'debuglevel' && DEBUGLEVEL[v])
			return '%s (%s)'.format(v, DEBUGLEVEL[v]);

		if (key == 'last_send' && typeof(v) == 'object')
			return _('%s, status %s, return code %s, %s bytes').format(v.date_time || '?', v.status || '?', v.retcode || '?', v.bytes || '?');

		if (Array.isArray(v))
			return v.length ? v.join(', ') : _('none');

		if (typeof(v) == 'object')
			return Object.keys(v).map(function(k) {
				return '%s: %s'.format(k, Array.isArray(v[k]) && v[k].length ? v[k].join(', ') : _('none'));
			}).join('; ');

		return String(v);
	},

	/* [ [ key, label, text, warn ], ... ] in display order */
	statusRows: function(st) {
		var self = this, rows = [], seen = {};

		LABELS.forEach(function(l) {
			seen[l[0]] = true;
			if (st[l[0]] !== undefined)
				rows.push([ l[0], l[1], self.formatValue(l[0], st[l[0]]), self.isWarningKey(st, l[0]) ]);
		});

		WARNING_KEYS.forEach(function(k) { seen[k] = true; });

		Object.keys(st).forEach(function(k) {
			if (!seen[k])
				rows.push([ k, k, self.formatValue(k, st[k]), false ]);
		});

		return rows;
	},

	renderStatus: function(text) {
		var st = this.parseStatus(text);

		if (st == null)
			return E('div', { 'class': 'alert-message error' },
				_('Could not read the ApmonD status. Is apmond installed?'));

		var warnings = this.statusWarnings(st);

		var table = E('table', { 'class': 'table' }, this.statusRows(st).map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left', 'width': '33%' }, [ r[1] ]),
				E('td', { 'class': 'td left', 'style': r[3] ? 'color:#c00;font-weight:bold' : null }, [ r[2] ])
			]);
		}));

		return E('div', {}, [
			warnings.length ? E('div', { 'class': 'alert-message warning' },
				warnings.map(function(w) { return E('p', {}, [ w ]); })) : '',
			table
		]);
	},

	load: function() {
		return this.fetchStatus();
	},

	render: function(text) {
		var self = this,
		    box = E('div', { 'id': 'apmond-status' }, [ this.renderStatus(text) ]);

		poll.add(function() {
			return self.fetchStatus().then(function(t) {
				dom.content(box, self.renderStatus(t));
			});
		}, 10);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ApmonD Status') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('The output of "apmond status", refreshed every 10 seconds.') ]),
			box
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
