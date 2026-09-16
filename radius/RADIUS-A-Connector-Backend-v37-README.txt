UCHIHA RADIUS-A · UI v101 / Backend v37
=======================================

Database schema: 30 (unchanged)
OpenAPI: 3.1.0 / API contract 1.8.0

New in v37
----------
Host / filesystem production preflight.

The connector can now prove that the machine itself satisfies the runtime assumptions before
launching workers or binding the production service.

Validated locally:
- Linux runtime
- Python >= 3.10
- SQLite >= 3.35
- SQLite thread-safety metadata
- Linux flock availability
- writable DB directory
- writable backup directory
- minimum free filesystem capacity
- real file create + flush + fsync
- atomic rename with os.replace
- cleanup of probe files
- no external network calls
- no server socket binding

CLI
---
python3 -S -B RADIUS-A-Connector-Backend-v37.py --check-host

Exit 0 means host preflight passed.
Exit 2 means host preflight blockers exist.

Production defaults
-------------------
UCHIHA_HOST_PREFLIGHT_REQUIRED=1
UCHIHA_HOST_MIN_FREE_BYTES=536870912
UCHIHA_LAUNCH_REQUIRE_HOST_PREFLIGHT=1

The default minimum free-space threshold is 512 MiB on both the database and backup filesystems.
It is a launch floor, not a capacity-sizing claim.

Runtime
-------
GET /api/connectors/radius/host-preflight

The response is secret-free and reports only runtime/storage readiness metadata.

Launch Gate
-----------
hostEnvironmentReady is now part of the strict configuration gate.
Service readiness also blocks on host-preflight-not-ready.

systemd
-------
The v37 unit performs:
1. --check-host
2. --check-config
3. normal ExecStart

This stops an unsuitable host before the application starts.

Retained security and operations
--------------------------------
v37 retains:
- Schema 30 production operator sessions
- hybrid browser-session + Gateway HMAC authentication
- scrypt password hashing and CSRF
- single-instance SQLite kernel flock
- release-integrity SHA-256 pinning
- atomic deployment and automatic rollback
- edge concurrency limit and slow-client timeout
- HMAC replay/failure protection
- verified local/off-host backup and restore drill
- graceful drain/checkpoint/post-deploy verification
- operational alerts/log shipping
- MikroTik gateway and targeted Direct RADIUS Disconnect-Request

Validation
----------
The Backend v37 integration suite proves:
- normal --check-host succeeds in a writable local Linux test environment
- fsync and atomic rename probes pass
- artificially impossible disk-space threshold returns exit 2
- disk-space blocker names are returned without secrets
- runtime host-preflight endpoint reports ready
- Launch Gate requires hostEnvironmentReady
- all previous operator-session, single-instance, edge, HMAC, backup, deployment and RADIUS tests still pass

The final production proof still must run on the real VPS and real external infrastructure.
