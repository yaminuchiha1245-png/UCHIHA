# UCHIHA Debt Telegram Admin v1.3 — Notification Center

This update extends the existing live bot, not the Android APK. Preserve the
existing private environment, bot.sqlite3, Telegram ID and Supabase database.

## New administrator interface

The main Telegram grid gains the 🔔 التنبيهات button:
- Enable or disable new Sham Cash top-up requests and open digital-product
  order notifications independently.
- Every notification goes only to the configured administrator's private chat.
- Includes customer name and basic amount or product information with a direct
  button to the relevant request. Private input fields and payment proofs are
  never sent in notifications.
- 🧪 تجربة تنبيه sends a synthetic sample without changing financial records.
- Register /start and /id bot commands scoped to the owner chat.

## Safety and performance

On the first successful backend scan, existing open requests are silently
baselined. Subsequent polls run at 60-second intervals; IDs are stored in
local SQLite to prevent repetitive notices. Muting a category discards its
pending alerts rather than flooding on unmute.

Telegram delivery failures retain pending alerts for the next poll.
When an older queued alert falls outside the 90 newest list results, a
specific-record fetch checks its live status before sending. The worker uses
a separate SQLite connection without blocking primary Telegram polling.
There is a tiny crash window between Telegram receipt and local sent marking
that can result in a duplicate notification, but not duplicate financial
operations.

Alerts are strictly read-only. The existing confirmation screens continue
to control all money movements and order status updates.

## Upgrade on the current VPS

Replace only bot.py in /opt/uchiha/debt-admin/, preserving private .env
and existing bot.sqlite3. Take a SQLite-consistent backup first, restart
uchiha-debt-admin.service, and check Telegram getMe and Supabase ping.
Two new SQLite tables are created automatically, without changing existing
financial or admin records. No new Supabase migration or bot token required.

Automated tests:
python3 -m py_compile build/debt180/bot/bot.py
python3 -m unittest discover -s build/debt180/tests -p 'test_*.py' -v

The tests include authorization, financial retries, suppressing old alerts,
muting, HTML escaping, retries after Telegram outages, durable notification
queues, and more than 90 simultaneous pending requests. For end-to-end live
assurance, trial a new request from a designated test account before relying
on the feature for time-sensitive payments.
