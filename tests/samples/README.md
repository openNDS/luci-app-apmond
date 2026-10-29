apmond 2.0.0_beta-r14 ubus output on Rob's GL-MT300N-V2 test pair, 29 Oct 2026:
`status_collector.json`, `nodes_collector.json` and `clients_collector.json` (`include_stale`) from
the collector (portal), `status_sender.json` from the sender (peer).
`nodes_lost_stale.json` is `nodes_collector.json` edited by hand: the peer is lost and needs a
restart, with one stale Wi-Fi client on a VXLAN (fields as docs/PROTOCOL.md), since the live pair
had no Wi-Fi client at the time. `read_log.txt` is one made-up log line.
