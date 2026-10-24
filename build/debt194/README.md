# Debt Store v1.5.38 — original-currency ledger balance

Base: `debt/performance-runtime-v193` at `8bbd7bc70c9970de87be6dbd84de083bd04fe5ad`.

`ledger-balance.patch` applies to the reconstructed v1.5.37 Android source. It preserves signed balances, identifies excess payments for review, carries credits into future same-currency purchases, and keeps the active screen and exports consistent. It does not delete transactions.

The v194 workflow keeps the prior release's regression checks, adds 13 numerical and application integration checks plus a real mobile browser check, and builds/signs the release through the existing persistent signing system. Existing currency and performance test expectations are updated to the new version only.

Expected package: `com.uchiha.debtstore`, version `1.5.38`, version code `1053800`.

Expected signing certificate SHA-256: `dd89d1b90fc8d1566f00af7dd460ae7affd98991731637fa4df6aa9716656197`.
