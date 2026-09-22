# UCHIHA Debt Store v1.5.27

- Prevents one user action from being committed twice while preserving intentional identical back-to-back transactions as separate operations.
- Gives each ledger operation a durable operation key, remote ID, and sync key.
- Makes the legacy cloud queue and additive partner-sync engine reuse the same transaction identity, preventing duplicate cloud rows during races/retries.
- Sends stable source keys for transactions and customers.
- Restricts heuristic transaction matching to legacy rows only.
- Makes legacy customer matching conservative and unique instead of merging by name alone.
- Changes partner permissions to default-deny unless a permission is explicitly granted.
- Existing ambiguous historical rows are not automatically deleted or merged.
