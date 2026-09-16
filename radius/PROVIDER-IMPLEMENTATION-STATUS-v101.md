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
- Exact `RADIUS-A-Master-v101.html` is bundled inside the Android APK input.
- Exact Backend v37 Production Kit v2 is present and protected by its published SHA-256 manifests.
- Baseline verifier checks v101 / v37 / Schema 30 identity, all kit hashes, the bundled Android asset and the production-only host.
- Backend v37 integration suite passes locally against the extracted exact source.

## Deliberately not enabled yet

- Router authentication/mutation.
- Backup/export execution on a real MikroTik.
- WAN/LAN/PPPoE/Hotspot staged configuration.
- Automatic rollback after a real router change.
- Server-verified activation.
- Persistent provider plans/subscribers.
- Real RADIUS accounting/quota enforcement.
- Real disconnect/reauth acceptance proof.

These are not marked complete because enabling state-changing router work before the backup/verify/rollback path and a real provider API are available would risk provider routers.

## Exact v37 mapping result

The exact v37 source is now integrated. Its published OpenAPI contract is a control-plane connector: health/readiness, operator sessions, commands, audited disconnect, node status, vouchers, backups and deployment operations.

The exact contract does **not** publish provider-facing activation, plan, subscriber or router-onboarding CRUD operations. No route has been invented to hide this gap. Server-verified activation and provider persistence therefore remain release blockers until an authorized v37-compatible contract/source is supplied and tested.

## Acceptance rule

Do not merge this branch as provider-ready and do not market the APK as production-ready until:

1. exact v37 source and its frozen v101 UI hashes remain intact;
2. Android candidate build passes CI;
3. a real MikroTik passes backup -> staged apply -> verify -> rollback drill;
4. activation, plan, subscriber, auth/accounting, quota and disconnect pass end-to-end;
5. real VPS launch reports `READY_TO_SERVE`, score `100`, blockers `[]`, and launch evidence `ok=true`.
