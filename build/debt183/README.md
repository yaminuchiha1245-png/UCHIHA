# UCHIHA Debt Telegram admin v1.4: Automatic local state backups

An additive update of the existing debt-store Telegram admin. It leaves the
Android APK, Supabase debt records, customer digital wallet balances, bot
token and administrator ID unchanged.

## Scope

The bot's own bot.sqlite3 contains update checkpoints, administrative wizards,
operation history, alert preferences and the durable notification queue.
It is NOT a backup of the Android customers' debt registers or of Supabase.
Those services require separate disaster-recovery backups.

Settings now includes an Arabic "bot backups" button showing the last backup,
file size and retained copies, with an option to create a local snapshot
immediately without using a VPS terminal.

## Daily retention and safety

The extra systemd timer runs backup.py once daily around 01:30 UTC with a
random delay up to 20 minutes. The SQLite online backup API snapshots the
database while the bot is online. The independent backup switches from WAL to
DELETE journal mode for portability, verifies its own integrity and required
tables, and is atomically published with 0600 mode. The backup folder is
0700 and symlink destinations are rejected BEFORE any permission changes.
Only the 14 most recent verified snapshots are retained.

The secret .env file is never copied to the backup folder or distributed
in the release archive. The bot's administrative operations and update
checkpoint remain intact.

For restoration, stop the bot, separately save current state, verify the
chosen snapshot's SQLite integrity and timestamps and only then copy it
back with correct ownership. Do not restore an old bot snapshot into a
running process.

Local copies live on the SAME VPS. Server or disk loss still requires
separately configured encrypted off-site backups. The timer by itself
does not protect against losing the server.

## Deployment

Install backup.py alongside bot.py, retaining the existing .env and
bot.sqlite3. Install and enable backup systemd timer/service units, run
the one-shot service once and verify the result. Restart the bot to
activate the new Telegram settings button. No database migration or
Telegram bot token change is needed.

Run python3 -m unittest discover -s build/debt180/tests -p test_*.py -v
for the suite covering all earlier admin features plus WAL snapshots,
privacy, retention, symlink defenses and administrator-only backup actions.
