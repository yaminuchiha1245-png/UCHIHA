# UCHIHA Debt Telegram Admin v1.5 — simplified menu and private customer PDFs

This release updates the existing Telegram admin bot for the debt-store platform.
It is **not** an Android APK update and does not overwrite any customer data,
bot token, earlier transaction logs, or current cloud backup payloads.

## Simple interface

The main panel now groups all existing functions into five button rows:

- Customers / digital wallet
- One-page PDF reports / create a new activation code
- Review digital-wallet top-up requests / digital-product orders
- New-request notifications / settings
- The two administrative logs / refresh

A PDF button is also visible inside each customer's existing detail page.
The report list allows searching by customer label or phone, and browsing
paginated results. Select a customer and the bot returns the PDF document
inside the admin's private Telegram chat. No terminal or manual token entry
is needed for generating a PDF after deployment.

## Exact content and crucial privacy distinction

The **account-summary PDF** contains the chosen app user's name, registered
phone, activation status and expiry, activated/allowed device count, digital
wallet balance, and up to five latest **digital-wallet** movements.

If the app user agreed to backup data, the report also shows aggregate
counts and the shop name from the latest encrypted-backup metadata, with its
actual timestamp. With no consent or no backup, the PDF shows a clear
unavailable message instead.

The PDF does NOT contain an itemized ledger of that shop owner's debtors,
individual debts or debt repayments: those details are stored inside an
encrypted backup payload inaccessible to the Telegram admin, and the PDF
must never misrepresent the app-user account summary as a customer debt
statement. Such detailed statements should be exported from the user's own
Android application, with permission.

The owner-authenticated backend RPC uses the already configured separate
256-bit bot secret and numeric Telegram ID, checks the active owner, limits
the target to an existing app customer, checks backup consent before
returning aggregate metadata, and never returns encrypted payload bytes,
activation code, customer-specific debt rows or payment-card details.
Telegram report delivery only occurs in the owner's private chat.

## PDF rendering and Telegram delivery

One A4 page; embedded DejaVu Arabic-capable font, with Arabic shaping and
right-to-left handling, consistent dark-blue UCHIHA branding. The PDF is
generated in memory and sent directly to Telegram as a document. No report
PDF is retained on the VPS and customer names do not appear in filenames.
Python dependencies are pinned in requirements-pdf.txt:
reportlab, arabic-reshaper, python-bidi.

## Deployment on existing VPS

1. Apply the additive database migration at
   build/debt184/sql/003_telegram_user_summary.sql through the authorized
   Supabase migration tool. It creates one new dedicated owner-gated
   read-only RPC function and preserves existing data.
2. Install the pinned PDF dependencies in the isolated bot venv. Debian
   systems also need the DejaVu Sans font package.
3. Preserve existing bot .env and bot.sqlite3. Take a consistent snapshot
   and back up the current bot.py.
4. Replace bot.py, install user_report_pdf.py, set the existing systemd
   service ExecStart to the isolated Python venv and restart. The daily
   administrative SQLite backup timer remains separate and unchanged.
5. Test ping, first-page menu, report-list, permission-denied anonymous RPC,
   and a read-only test PDF before releasing live report requests.

**No Telegram bot token changes and no financial writes are required.**

CI runs all prior money safety, role, activation, alert, backup and user-PDF
tests plus one-page PDF render inspection, preventing regressions.
