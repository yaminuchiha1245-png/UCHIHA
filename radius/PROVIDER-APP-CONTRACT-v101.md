# UCHIHA RADIUS v101 — Provider App Integration Contract

Status: candidate contract for `radius-provider-ready-v101`.

This document does **not** claim that these route names already exist in Backend v37. The exact v37 source must be mapped before the Android/UI layer hard-codes production endpoints. The contract exists to keep the provider experience and security requirements stable while preserving the frozen v101 UI.

## Product rule

The provider completes normal work inside the UCHIHA RADIUS app. VPS, GitHub, terminal, FreeRADIUS internals and RouterOS command syntax are not part of the provider-facing workflow.

Infrastructure may run server-side, but it remains an implementation detail.

## Android native boundary

The Android shell currently exposes `window.UchihaProviderApp` with:

- `environment()` — app/network capability snapshot.
- `installationId()` — app-scoped UUID for activation binding; not IMEI/MAC/phone number.
- `validateActivationCode(code)` — syntax validation only; server verification remains mandatory.
- `network()` — local DHCP/gateway information.
- `discoverRouters()` — conservative RFC1918 router discovery.
- `probeRouter(host)` — read-only port reachability check.
- `validateRouterSetup(draft)` — validates and sanitizes a router setup draft.
- `validatePlan(draft)` — validates a provider plan in Mbps/GB/days/TRY.
- `openWifiSettings()` — helps the provider connect the phone to the router network.
- `requestActivation()` — opens the configured WhatsApp activation request.

No MikroTik or RADIUS secret is persisted by this boundary.

## Server-backed capability contract

The v37 mapping/extension must provide equivalent operations for these capabilities. Exact route names are intentionally left to the v37 source mapping.

### Activation

Input:
- activation code
- installation ID
- app build

Result:
- valid/invalid
- provider/tenant identity
- subscription status and expiry
- allowed device/session policy

Rules:
- activation is verified server-side
- raw activation codes are not logged
- replay and rate limits are enforced

### Router onboarding

Stages:
1. discover or enter private router IP
2. authenticate for this onboarding session only
3. read identity/model/RouterOS version/interfaces
4. create a router backup/export before mutation
5. validate intended WAN/LAN/service changes
6. apply in small stages
7. verify local management reachability after every stage
8. verify Internet/RADIUS after final stage
9. rollback if a required verification fails

Credentials must be memory-only on Android and must never be copied into browser localStorage/sessionStorage, logs, analytics, crash reports or backend generic audit payloads.

### Router configuration draft

Minimum normalized fields:
- provider router name
- private management IP
- WAN interface
- LAN interface list
- upstream type: DHCP / PPPoE / Static
- service mode: PPPoE / Hotspot / Both
- backup-before-apply = true
- staged-apply = true
- rollback-required = true

Sensitive upstream PPPoE password is accepted only for the active operation and is never returned in normalized responses.

### Plans

Minimum fields:
- name
- download Mbps
- upload Mbps
- quota GB
- quota period: none / daily / monthly
- duration days
- price in TRY
- post-quota action: block / throttle / add-on
- throttle speed when applicable
- router/branch scope

The server remains authoritative for quota counters and subscription state.

### Subscribers and accounting

Required operations:
- create/edit/suspend/renew subscriber
- assign/change plan
- display expiry and current online state
- persist RADIUS Start / Interim / Stop accounting
- roll up usage by provider/router/subscriber/day/month
- enforce daily/monthly quota reset in provider timezone
- issue audited disconnect/reauth requests

### Multi-provider isolation

Every router, plan, subscriber, session, invoice/report and audit record must be scoped to the authenticated provider/tenant. No client-provided provider ID is trusted without server-side authorization.

## Release gate

This contract does not make the product provider-ready by itself. Production acceptance remains blocked until the exact v101 / Backend v37 / Schema 30 production kit is present and the real VPS + real MikroTik flow passes activation -> router onboarding -> plan -> subscriber -> authentication -> accounting -> quota -> disconnect, followed by READY_TO_SERVE / score 100 / blockers [].
