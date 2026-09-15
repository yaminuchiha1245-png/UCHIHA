# UCHIHA RADIUS v101 — Provider-ready implementation status

Branch: `radius-provider-ready-v101`
Base: `radius-production`
UI baseline: v101 (frozen; do not replace with an older UI)
Backend target: v37
Database schema target: 30

## Implemented on the Android/provider branch

- Existing v101 WebView UI preserved; no UI rebuild.
- Restricted native bridge exposed as `UchihaProviderApp`.
- First-party host allowlist and WebView hardening.
- App-scoped installation UUID for future server activation binding.
- WhatsApp activation request handoff.
- Activation code format validation (not server activation).
- Local DHCP/gateway discovery.
- Conservative private-network router discovery including the MikroTik factory-default address.
- Read-only reachability probe for RouterOS API/API-SSL and HTTP/HTTPS.
- Wi-Fi settings handoff.
- Router setup draft validation for WAN/LAN/upstream/service mode.
- Plan validation for download/upload Mbps, quota GB, daily/monthly period, duration, TRY price and post-quota action.
- Sensitive PPPoE password omitted from normalized validation output.
- Candidate APK workflow updated to build the provider branch and PR.

## Deliberately not enabled yet

- Router authentication/mutation.
- Backup/export execution on a real MikroTik.
- WAN/LAN/PPPoE/Hotspot staged configuration.
- Automatic rollback after a real router change.
- Server-verified activation.
- Persistent provider plans/subscribers.
- Real RADIUS accounting/quota enforcement.
- Real disconnect/reauth acceptance proof.

These are not marked complete because enabling state-changing router work before the backup/verify/rollback path and the exact v37 integration are available would risk provider routers.

## Current external blocker

The exact `RADIUS-A-Connector-Backend-v37.py` / full Backend v37 Production Kit is not present in the working repository branch. The available handoff documents identify it as the required production backend, but route mapping and real integration must be performed against the exact source rather than guessed from older backends.

## Acceptance rule

Do not merge this branch as provider-ready and do not market the APK as production-ready until:

1. exact v37 source is integrated without downgrading v101;
2. Android candidate build passes CI;
3. a real MikroTik passes backup -> staged apply -> verify -> rollback drill;
4. activation, plan, subscriber, auth/accounting, quota and disconnect pass end-to-end;
5. real VPS launch reports `READY_TO_SERVE`, score `100`, blockers `[]`, and launch evidence `ok=true`.
