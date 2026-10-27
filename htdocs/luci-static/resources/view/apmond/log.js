'use strict';
'require view';
'require fs';
'require ui';
'require dom';
'require view.apmond.version as apmondver';

/* ApmonD log: the output of "apmond read_log" (exits 1 with no output when there is no log file yet) */

var APMOND = '/usr/sbin/apmond';

return view.extend({
	fetchLog: function() {
		return L.resolveDefault(fs.exec_direct(APMOND, [ 'read_log' ]), null);
	},

	logText: function(text) {
		if (text == null)
			return _('Could not read the ApmonD log. Is apmond installed?');

		if (String(text).trim() === '')
			return _('The log is empty, or no log file has been written yet.');

		return String(text);
	},

	load: function() {
		return this.fetchLog();
	},

	render: function(text) {
		var self = this,
		    pre = E('pre', { 'style': 'white-space:pre-wrap; max-height:40em; overflow-y:auto' }, [ this.logText(text) ]);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('ApmonD Log') ]),
			E('div', { 'class': 'cbi-map-descr' }, [ _('The output of "apmond read_log". Logging uses the debug level set in Settings.') ]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': ui.createHandlerFn(this, function() {
						return self.fetchLog().then(function(t) {
							dom.content(pre, self.logText(t));
							pre.scrollTop = pre.scrollHeight;
						});
					})
				}, [ _('Refresh') ])
			]),
			pre,
			apmondver.footer()
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
