'use strict';
'require baseclass';
'require fs';
'require dom';

/*
 * luci-app-apmond version, as apmond and mesh11sd: these two lines are the only place to change
 * at a version bump. Not a page of its own (it is not in the menu); the apmond views require it
 * as view.apmond.version and show footer() at the bottom of each page.
 */

var last_version = '1.0.0';
var version = '1.0.1~be7a';

var APMOND = '/usr/sbin/apmond';

return baseclass.extend({
	version: version,
	last_version: last_version,

	/*
	 * "apmond -v" prints "apmond version x.y.z" (apmond 1.0.1 and later, as mesh11sd -v);
	 * returns x.y.z, or null. apmond 1.0.0 has no -v: it prints "Unknown option [ -v ]" and its
	 * help and exits 1, with no other effect, so this returns null and the page shows "unknown".
	 */
	parseApmondVersion: function(text) {
		var m = String(text == null ? '' : text).match(/^apmond version (\S+)/m);

		return m ? m[1] : null;
	},

	/* resolves to the installed apmond version, or null if apmond could not be run */
	fetchApmondVersion: function() {
		var self = this;

		return L.resolveDefault(fs.exec_direct(APMOND, [ '-v' ]), null).then(function(text) {
			return self.parseApmondVersion(text);
		});
	},

	/* the footer text; apmondVersion undefined while it is being read, null if it could not be read */
	footerText: function(apmondVersion) {
		var t = _('luci-app-apmond %s').format(version);

		if (apmondVersion === undefined)
			return t;

		return '%s, %s'.format(t, _('apmond %s').format(apmondVersion || _('unknown')));
	},

	/* a small line for the bottom of a page; the apmond version is filled in when it arrives */
	footer: function() {
		var self = this,
		    node = E('div', { 'class': 'apmond-version', 'style': 'text-align:right; font-size:smaller; opacity:0.7; margin-top:1em' },
			[ this.footerText() ]);

		this.fetchApmondVersion().then(function(v) {
			dom.content(node, self.footerText(v));
		});

		return node;
	}
});
