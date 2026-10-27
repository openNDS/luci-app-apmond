Sample output captured from the apmond 1.0.0 mock test harness (openNDS/apmond tests/run-mock-test.sh):
router `status`, peer `status`, `show_ap_data all` on the collector, `get_ap_data` on a peer and `read_log`.
`apmond.config` is the shipped /etc/config/apmond of apmond 1.0.0.
`get_ap_data_gl-mt300n-v2.json` is real r22 output from a GL-MT300N-V2 peer (guest client on VLAN 20).
The test work directory in the paths was renamed to /tmp/apmond-test.
`show_ap_data_addresses.json` is `show_ap_data all` from the apmond 1.0.1 mock test harness (section 15e) with the
node_ula and ipv4_addresses node_status fields: peer C with two IPv4 addresses, router R with none. The random test
ULA prefix was renamed to fd18:cef4:6dbd:baa0 as in the other samples.
