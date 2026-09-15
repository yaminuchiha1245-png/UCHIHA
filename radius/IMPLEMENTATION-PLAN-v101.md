# UCHIHA RADIUS v101 — Provider-ready implementation plan

Baseline is frozen to UI v101 / Backend v37 / Schema 30. This work extends the current v101 product and must not replace it with an older UI or rebuild the interface from scratch.

## Product rule
The network provider completes normal work inside UCHIHA RADIUS. VPS, GitHub, RADIUS internals and server administration remain invisible to the provider.

## Delivery sequence
1. Protect v101 baseline and Android wrapper.
2. Native Android capability bridge: device/network state, WhatsApp activation request, local-router reachability, safe router onboarding plumbing, error states.
3. Activation: server verification, entitlement, expiry/renewal and session/device policy.
4. MikroTik onboarding: discover/add-by-IP, test credentials, read-only facts first, backup, staged configuration and rollback.
5. Router setup wizard: WAN source (PPPoE/DHCP/Static), WAN/LAN selection, DHCP/NAT/DNS/firewall baseline, PPPoE/Hotspot and RADIUS registration.
6. Plans: download/upload Mbps, daily/monthly quota, reset schedule, duration, TRY price, post-quota policy and router/branch scope.
7. Subscribers: create/edit/suspend/renew, plan assignment, credentials, expiry, quota and online state.
8. Accounting/live controls: auth/accounting persistence, usage rollups, daily reset, audited disconnect/re-auth.
9. Multi-provider isolation and billing/reporting.
10. Real VPS + real MikroTik acceptance, release signing and production APK.

## Safety / integrity gates
- Never store RADIUS shared secrets or MikroTik credentials in browser localStorage.
- Router changes are preceded by a backup and applied in ordered stages.
- Failed staged setup must provide rollback/retry state, never silently continue.
- Tenant/provider scope is mandatory on every server-side entity.
- Production is not declared ready until the end-to-end real MikroTik flow passes.
