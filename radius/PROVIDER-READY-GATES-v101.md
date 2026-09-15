# UCHIHA RADIUS — Provider-ready gates (v101 baseline)

Baseline is frozen at UI v101 / Backend v37 / Schema 30. No older UI is an acceptable source.

## Provider experience

A provider must be able to complete normal work without VPS, GitHub, terminal or Winbox. Infrastructure remains server-side and invisible.

## Required functional gates before production release

1. Activation: server-verified one-time activation code, subscription state, expiry/renewal, device/session policy, WhatsApp request action.
2. MikroTik onboarding: local-network discovery/add-by-IP, secure credential handoff, test connection, backup before change, staged configuration, rollback on failure.
3. Router setup: upstream PPPoE/DHCP/Static, WAN/LAN selection, DHCP/NAT/DNS/firewall baseline, PPPoE/Hotspot mode, RADIUS registration and post-change internet test.
4. Plans: down/up Mbps, daily/monthly quota, reset time, duration, TRY price, post-quota action (block/throttle/add-on), assign to all routers or selected branches.
5. Subscribers: create/edit/suspend/renew, plan assignment, credentials, expiry, quota/usage, currently-online state.
6. RADIUS accounting: authentication + accounting persisted by provider/tenant/router/subscriber, session start/stop/interim updates, usage rollups, daily reset.
7. Live controls: targeted disconnect/re-auth only with audited backend gate; no RADIUS or MikroTik secret stored in browser storage.
8. Multi-provider isolation: every provider, router, plan, subscriber, session and report isolated by tenant/provider scope.
9. Billing/reporting: prices in TRY by default, payment/renewal history, revenue and outstanding balances, exportable reports.
10. Operations: health checks, backup/restore, audit log, alerts, rate limits, offline/error states and safe retries.

## Release acceptance

Do not call the system provider-ready until the real VPS, real v37 backend and at least one real MikroTik test environment pass the complete activation -> router onboarding -> plan -> subscriber -> login -> accounting -> quota -> disconnect flow, while the launch gate reports READY_TO_SERVE, score 100 and blockers [].
