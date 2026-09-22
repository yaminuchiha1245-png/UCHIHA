# UCHIHA Debt Telegram Admin v1.2 — renewals and transaction recovery

This is an additive update to the existing Arabic Telegram admin bot for
the UCHIHA Debt Store, not a new bot. It preserves Android app data,
Telegram token, saved credentials and bot.sqlite3 administrative state.

## New management actions

- The customer detail screen now has Renewal (30, 90, 365 days, or no expiry).
  An active paid period is preserved: renewal adds days to the existing
  future expiration, or starts counting from now if already expired.
- Unlimited customer licenses are not silently changed to limited licenses.
- Set the maximum authorized devices to 1, 2, 3 or 5 per customer. Reducing
  the limit below already activated device count requires an explicit reset
  via the existing reset button.
- Subscription and device-limit changes are audited in the backend.
- Every license management action carries a unique persisted request ID.
  Retrying the same ID returns the original result; it cannot double-extend.
- A code-creation operation interrupted after being sent to the backend
  will not run a second time just because the bot restarts.
- The customer detail screen shows expired status distinctly from a
  manually disabled account. Existing balance and top-up rules are unchanged.

## Release and deployment

The SQL migration in build/debt181/sql/002_admin_renewals.sql is additive:
one protected request-deduplication table and one authenticated RPC
function. It does not change existing wallet, order or license rows.

After deploying the SQL, replace only bot.py on the existing VPS, preserving
.env and bot.sqlite3, then restart uchiha-debt-admin.service. The service
does not need the Telegram token or Supabase service-role key again.

For automatic checks, from the repo root, run:
python3 -m unittest discover -s build/debt180/tests -p test_*.py -v

Production rollout should be followed by a no-mutation backend ping and
Telegram getMe, plus a supervised trial with a test customer before renewal
is used on customers with meaningful prepaid subscriptions.
