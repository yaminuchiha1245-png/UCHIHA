# UCHIHA Debt Telegram admin v1.6 — debtor statements from a shop backup

This is an incremental bot release based on the currently live v1.5 branch.
It does not touch Android financial records, restore a customer automatically,
revoke a license, rotate a bot token, or read/decrypt cloud-backup ciphertext.

## Critical distinction

A "user" of the debt app is a licensed shopkeeper who maintains an independent
list of *shop debtors* (زبائن المحل). v1.5 PDF was an admin summary of the licensed
shopkeeper's subscription and digital-wallet balance, not a statement of the
shop's debtors.

v1.6 adds the requested native-style debtor statement from a FULL debt app
JSON snapshot. The shopkeeper/authorized support owner must obtain that JSON
backup from the app, and provide consent. The bot does not have direct access
to the cloud-encrypted backup's individual debt rows through its current
server API. Never describe this version as automatic cloud PDF retrieval.

## User flow (owner Telegram private chat only)

1. Tap 📒 كشوف الزبائن and confirm the shopkeeper's permission.
2. Upload an app-exported .json full backup as a Telegram document, max 6 MB.
3. Search/shop browse by debtor name or phone in the temporary list.
4. Choose PDF مختصر (last ten debt transactions), PDF كامل (all transactions
   up to 1000), or JSON for **this debtor only**.

The PDF is a human-readable statement, visually modeled after the dark-style
debt ledger PDF in the Android app: shop and debtor, total purchases, payments,
outstanding debt, transaction dates, types, original currencies, amounts and
historical running balances. It contains the original uploaded-file SHA-256
prefix so support can correlate the PDF to a backup.

The separate JSON contains the selected debtor and their original entry IDs,
ledger records, currency rates and source hash. It deliberately excludes other
debtors, admin account PIN hashes, service tokens and cloud configuration.
It is a manual recovery reference, NOT a full application backup format.
The current APK only implements full-shop snapshot restoration. Do not paste
individual-debtor JSON over that feature, as it could overwrite other records.

## Privacy

- Only the already configured numeric Telegram administrator can access the
  upload wizard, document download or generated reports in private chat.
- The administrator explicitly confirms the shopkeeper's authorization.
- The uploaded backup is kept only in the bot's application memory for up to
  20 minutes, not written into bot.sqlite3, the filesystem or GitHub.
- When the user ends the session or the TTL expires, its retained normalized
  data is discarded. Admin passwords and credential fields are dropped during
  normalization; the initial raw upload is not retained.
- Exports are streamed directly from memory to Telegram; files are not
  retained on the VPS. Recipients should not forward private customer reports.

## Important recovery limitations

If the client lost all app data and no usable JSON copy exists, the bot cannot
create an itemized debtor PDF on its own. The existing Android owner-support
backup flow can fetch the latest encrypted server snapshot ONLY with the
app user's backup consent and an audited support reason. Download a copy
there and upload its JSON to this new bot wizard. Older snapshots may be
necessary if the lost debtor had been deleted before the newest snapshot.

Use the latest verified FULL shop backup to restore the entire app. Prefer
manual reconciliation for a single missing debtor until a dedicated
ID-preserving merge/import action exists in the Android app. PDF is not
a machine-restorable data format and may omit older transactions in brief mode.

## Deployment

No new Supabase migration or user reactivation required.
Replace existing bot.py, add debtor_statement.py, keep current .env,
bot.sqlite3 and user_report_pdf.py unchanged. Current PDF libraries are
already installed in the isolated service Python virtualenv.
Make a SQLite-consistent backup before restarting the service.

Regression suite also tests protected digital-wallet workflows, subscription
renewals, notification durability, daily bot state backup, owner-only
upload, no PIN/token leakage, orphaned data handling, PDF page boundaries,
and debtor-scoped JSON recovery.
