# MikroTik record management — integration snapshot (2026-09-26)

**QA-only draft; not live production.**

- Compact V1-83 UI and phone-size Telegram MikroTik sheet remain byte-for-byte based on `f1608df000c57cb424c27a345cecb6b4de0a2412` (no provider UI overlay).
- API, migration, signed agent and backend tests copied verbatim from reviewed MikroTik core `4f52799bc9afcc16dbf43a3c091fea13f5c4e6ef` (PR #81).
- Telegram management screens, native edit/delete confirmations and bot tests copied verbatim from `8766fbd4f6fa31b23c988545efa64fe670c0c5cc` (PR #95; includes owner retry fixes from #91).
- The existing target branch's Telegram CI workflow is preserved; the core workflow is included for full API + disposable PostgreSQL checks. The bot PR's optional previous-candidate re-overlay job is intentionally excluded because this branch is now itself the current combined candidate.
- New DELETE requires authenticated owner/admin, checked host + record version, confirmation and an idempotency key. Reject active sessions or pending disconnections; historical accounting remains attached to subscribers but router FK detaches. Deletion does not remove a physical router or modify its on-site agent configuration.

Promotion requires an independently restorable complete customer backup, privileged schema grants, live signed Telegram identities, authorized TLS/RouterOS proof and PPPoE/Hotspot AAA/accounting checks. Never run destructive CI database fixtures on the VPS.
