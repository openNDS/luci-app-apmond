'use strict';
'require view';
'require form';
'require uci';
'require dom';

/*
 * ApmonD settings: the single "config apmond 'setup'" section of /etc/config/apmond.
 * Every option is optional and has a built-in default in apmond, so defaults are shown as
 * placeholders and an option is only written when it is changed.
 */

var DEFAULT_SEED = '--__';

return view.extend({
	load: function() {
		return uci.load('apmond');
	},

	/* true when apmond would use its built-in default passphrase */
	seedIsDefault: function(seed) {
		return (seed == null || seed === '' || seed === DEFAULT_SEED);
	},

	/*
	 * ListValue that never writes its default to an unset option: picking the default
	 * leaves the option unset, or removes it if it was set.
	 */
	listDefault: function(o, dflt) {
		o.default = dflt;
		o.write = function(section_id, value) {
			if (value === dflt) {
				if (this.cfgvalue(section_id) != null)
					return this.remove(section_id);
				return;
			}
			return form.ListValue.prototype.write.apply(this, [ section_id, value ]);
		};
		return o;
	},

	seedNotice: function() {
		return E('div', { 'class': 'alert-message notice' },
			_('The built-in default passphrase is in use. Make ApmonD more secure by adding your own passphrase, the same on every node.'));
	},

	render: function() {
		var self = this, m, s, o;

		m = new form.Map('apmond', _('ApmonD'),
			_('ApmonD monitors the access points of your network. Every node, the access points and the router, runs the same daemon and should have identical settings.'));

		s = m.section(form.NamedSection, 'setup', 'apmond', _('Settings'));
		s.anonymous = true;
		s.addremove = false;

		s.tab('general', _('General Settings'));
		s.tab('advanced', _('Advanced Settings'));

		/* General */

		o = s.taboption('general', form.Flag, 'enabled', _('Enabled'),
			_('Run the ApmonD daemon on this node.'));
		o.default = '1';

		o = s.taboption('general', form.Value, 'apmon_seed', _('Passphrase'),
			_('Identical on every node. The report signing secret and the IPv6 ULA prefix are both derived from it. While it is empty a built-in default is used. Make ApmonD more secure by adding your own passphrase.'));
		o.password = true;
		o.rmempty = true;

		o = s.taboption('general', form.Value, 'interval', _('Report interval'),
			_('Seconds between reports, minimum 10. Default 30.'));
		o.datatype = 'and(uinteger,min(10))';
		o.placeholder = '30';

		o = s.taboption('general', form.Value, 'device', _('Device'),
			_('The device that carries the ULA addresses; its MAC address identifies this node. On a VLAN filtering bridge the lan VLAN device is used automatically. Default br-lan.'));
		o.placeholder = 'br-lan';

		o = s.taboption('general', form.DynamicList, 'bridge', _('Wired client bridges'),
			_('Bridges scanned for wired clients. Leave empty or use "auto" to scan every bridge except the wan bridge, detected again on each pass, or list bridge names to scan only those.'));
		o.placeholder = 'auto';

		o = s.taboption('general', form.ListValue, 'debuglevel', _('Debug level'));
		o.value('0', _('0 - errors'));
		o.value('1', _('1 - notices'));
		o.value('2', _('2 - info'));
		o.value('3', _('3 - debug'));
		this.listDefault(o, '1');

		/* Advanced */

		o = s.taboption('advanced', form.ListValue, 'router_detect', _('Router detection'),
			_('The router, the node with an upstream wan gateway, is the collector that every node reports to.'));
		o.value('1', _('Auto detect'));
		o.value('0', _('Force router/collector'));
		o.value('2', _('Force peer'));
		this.listDefault(o, '1');

		o = s.taboption('advanced', form.Value, 'router_takeover_misses', _('Router takeover misses'),
			_('A backed-off router takes over the collector address after it has not answered this many checks. Default 3.'));
		o.datatype = 'min(1)';
		o.placeholder = '3';

		o = s.taboption('advanced', form.Value, 'claim_delay_max', _('Maximum claim delay'),
			_('Random delay of 0 to this many seconds before the collector address is first claimed. Default 10.'));
		o.datatype = 'uinteger';
		o.placeholder = '10';

		o = s.taboption('advanced', form.Value, 'startup_delay', _('Startup delay'),
			_('Seconds before the first report. Default 60.'));
		o.datatype = 'uinteger';
		o.placeholder = '60';

		o = s.taboption('advanced', form.Value, 'log_mountpoint', _('Log mountpoint'),
			_('Where the log and the access point data are kept, for example /mnt/usb. It must be an exact mountpoint and writable, otherwise /tmp is used. Default /tmp.'));
		o.placeholder = '/tmp';
		o.validate = function(section_id, value) {
			if (value != null && value !== '' && value.charAt(0) !== '/')
				return _('Must be an absolute path');
			return true;
		};

		o = s.taboption('advanced', form.Value, 'max_log_entries', _('Maximum log entries'),
			_('The log file is truncated to the last this many lines. Default 500.'));
		o.datatype = 'uinteger';
		o.placeholder = '500';

		o = s.taboption('advanced', form.Value, 'cgi_dir', _('CGI directory'),
			_('Where the daemon writes the receiver apmon.cgi at startup. Change it only if a web server other than uhttpd serves /cgi-bin/ from another directory. Default /www/cgi-bin.'));
		o.placeholder = '/www/cgi-bin';
		o.validate = function(section_id, value) {
			if (value != null && value !== '' && value.charAt(0) !== '/')
				return _('Must be an absolute path');
			return true;
		};

		o = s.taboption('advanced', form.Value, 'max_age', _('Maximum report age'),
			_('Reports older or newer than this many seconds are rejected. Default 120.'));
		o.datatype = 'uinteger';
		o.placeholder = '120';

		o = s.taboption('advanced', form.Value, 'max_report_size', _('Maximum report size'),
			_('Largest accepted report, in hex characters. Default 1048576.'));
		o.datatype = 'uinteger';
		o.placeholder = '1048576';

		o = s.taboption('advanced', form.Value, 'default_seed_warn_interval', _('Default passphrase warning interval'),
			_('Seconds between log warnings while the built-in default passphrase is in use. Default 21600 (6 hours).'));
		o.datatype = 'uinteger';
		o.placeholder = '21600';

		o = s.taboption('advanced', form.Flag, 'verbose_debug', _('Verbose debug'),
			_('Also log the full user agent and node id strings at debug level 3.'));
		o.default = '0';

		return m.render().then(function(node) {
			/* the notice lives outside the map, which re-renders its own contents on save */
			self.noticeSlot = E('div', {});
			self.updateSeedNotice();
			return E('div', {}, [ self.noticeSlot, node ]);
		});
	},

	/* show the default passphrase notice while the saved config has no passphrase of its own */
	updateSeedNotice: function() {
		if (!this.noticeSlot)
			return;

		dom.content(this.noticeSlot,
			this.seedIsDefault(uci.get('apmond', 'setup', 'apmon_seed')) ? this.seedNotice() : null);
	},

	/*
	 * Save (also used by Save & Apply): the map saves and reloads the uci data, then the
	 * notice follows the saved value, gone once a passphrase is saved, back if it is cleared
	 */
	handleSave: function(ev) {
		var self = this;

		return Promise.resolve(this.super('handleSave', [ ev ])).then(function(rv) {
			self.updateSeedNotice();
			return rv;
		});
	}
});
