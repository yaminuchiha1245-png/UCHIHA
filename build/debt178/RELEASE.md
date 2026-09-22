# UCHIHA Debt Store v1.5.28

This release extends the v1.5.27 ledger protection to the remaining financial flows.

- Invoice submissions are guarded against accidental double registration.
- Every invoice ledger row gets a durable remote ID, sync key, and operation key even when created offline.
- Digital purchases send a stable client request ID and reuse it after timeout/retry.
- SMM purchases use the same retry-safe request identity.
- Balance top-up requests are idempotent across timeout/retry.
- Owner wallet adjustments are idempotent across timeout/retry.
- Server-side helpers serialize identical request IDs and return the existing order/top-up/adjustment instead of charging twice.
- Provider retries reuse the same provider order UUID.
- Intentional identical purchases remain separate because a new confirmed action gets a new request ID.
- Historical ambiguous transactions are preserved; no amount/date-based auto-deletion is performed.

Production database migration: digital_idempotency_guards_v178.
