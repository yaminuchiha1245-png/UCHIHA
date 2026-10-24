# Debt Store v1.5.39 — strict payment invariant

Base: `debt/ledger-balance-v194` at `16e9b5a9e42b21b5a93dfa0b9cff900dc7f2f373`.

The product prohibits payments above the remaining original-currency debt. Excess historical records are retained for review and do not create customer credit or settle later purchases.

Connected payments now require a fresh sync and an atomic server receipt before being posted locally. A durable operation identity survives uncertain network responses; retrying it returns the same receipt. Unconfirmed legacy payments do not reduce displayed debt, and explicit server rejections remain available for review.

`payment_guard.sql` adds an authenticated, invoker RPC and a private trigger that serializes ledger mutations with a row write. It validates original-currency debt, rejects stale backdated payment uploads, protects purchase edits, and also covers raw inserts from old releases. It does not delete or modify existing financial rows.

CI runs 22 application regressions, 13 isolated PostgreSQL concurrency and RLS regressions, the existing release regressions, and the actual mobile browser flow. The signing identity and Android package remain the existing production identity.

Package `com.uchiha.debtstore`; version `1.5.39`; code `1053900`.
