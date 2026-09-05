# Game Zone production deployment

## Requirements
- Linux VPS
- Docker + Docker Compose plugin
- a domain pointed to the VPS
- Telegram bot token
- production secrets

## Generate strong application secrets

Instead of hand-writing application secrets:

```bash
node generate-secrets.js --domain your-domain.com --out .env.production
```

The generator does not print secret values and refuses to overwrite an existing file unless `--force` is supplied.

You must still fill in external account values such as Telegram, supplier and payment credentials.

## Deploy

```bash
cd deploy
cp .env.production.example .env.production
# edit all values
docker compose --env-file .env.production up -d --build
```

Caddy obtains HTTPS automatically for the configured domain.

## Check

```bash
docker compose ps
docker compose logs -f server
docker compose logs -f bot
```

Open:

- Store: `https://YOUR_DOMAIN`
- Admin: `https://YOUR_DOMAIN/admin/`
- Health: `https://YOUR_DOMAIN/api/health`

## Telegram
In BotFather, set the Mini App / Web App URL to the same HTTPS domain.

Also set `BOT_USERNAME` in `.env.production`. It is required for standalone Android account pairing.


## Production preflight

Before starting the stack:

```bash
node preflight.js .env.production
```

It checks required values, rejects obvious placeholders, validates secret length and the inventory encryption key without printing secrets.

After deployment:

```bash
./check-live.sh your-domain.com
```

Then sign in to `/admin/` and check **التشغيل → جاهزية الإنتاج**.



## RC13 production safety values

Keep these enabled on the production Server:

```env
STORAGE_DRIVER=postgres
STORAGE_FAIL_FAST=true
PG_SINGLE_INSTANCE_LOCK=true
AUDIT_HMAC_KEY=YOUR_DISTINCT_32_PLUS_CHAR_SECRET
STATE_HMAC_KEY=YOUR_DISTINCT_STATE_HMAC_SECRET
PG_STATE_HISTORY_MAX=200
PG_STATE_HISTORY_RETENTION_DAYS=90
PG_STATE_HISTORY_MIN_INTERVAL_SECONDS=300
STATE_VERIFY_INTERVAL_MS=300000
INTERNAL_BOT_SECRET=YOUR_DISTINCT_BOT_TRANSPORT_SECRET
INTERNAL_BOT_ADMIN_SECRET=YOUR_DISTINCT_LEAST_PRIVILEGE_BOT_ADMIN_SECRET
ALLOW_LEGACY_ADMIN_KEY=false
```

The current PostgreSQL driver is a single-writer JSONB snapshot architecture. Do not scale the `server` service to multiple active replicas.

## Backups

Create a persistent application-state backup:

```bash
./backup.sh
```

Restore a backup path shown by the backup command:

```bash
./restore.sh /app/server/backups/game-zone-YYYY-MM-DD....json
```

PostgreSQL data itself is also persisted in the `gamezone_postgres` Docker volume.


## Automatic backups

The Compose stack includes a `backup` worker. It creates a JSON application-state backup in the persistent `gamezone_backups` volume every 24 hours by default.

Change:

```env
BACKUP_INTERVAL_SECONDS=86400
```

The manual `./backup.sh` and `./restore.sh` tools remain available.


## RC13 staging supplier simulator

To test supplier flow before connecting a real API:

```bash
docker compose --env-file .env.production --profile staging up -d --build
```

The internal staging supplier is reachable by the Game Zone server at:

```text
http://provider-simulator:4010
```

See `../docs/STAGING-PROVIDER-SIMULATOR.md`.

## Validate a backup

Backups now use the standardized `game-zone-backup` wrapper.

Inside the Server container:

```bash
npm run backup:validate -- /app/server/backups/FILENAME.json
```

Restore accepts both the standardized RC13 format and older raw Game Zone DB backups.


## RC13 encrypted backups

Production requires a dedicated 32-byte `BACKUP_ENCRYPTION_KEY` different from `INVENTORY_ENCRYPTION_KEY`.

Automatic/manual backups are encrypted with AES-256-GCM and contain the normal inner SHA-256 verified Game Zone backup.

The backup service has a healthcheck that decrypts and verifies the latest backup content.

Manual backup:

```bash
./backup.sh
```

Restore is exclusive: `restore.sh` stops Bot/Caddy/Server, runs a one-off restore container, verifies read-back, then starts services again.

```bash
./restore.sh /app/server/backups/FILENAME.json
```


## RC13 state verification and point-in-time recovery

Verify the active PostgreSQL row and retained recovery history:

```bash
./state-verify.sh
```

List recent recovery revisions:

```bash
./state-history.sh 20
```

Restore a verified historical revision as a new active revision:

```bash
./state-rollback.sh 123
```

`state-rollback.sh` stops the public writer services, acquires the Game Zone PostgreSQL writer advisory lock, saves the current state, restores the trusted history snapshot, verifies read-back and restarts the stack.

If the active state is already corrupt, it is saved as a forensic snapshot rather than being inserted into trusted history.

RC13 full `restore.sh` can likewise recover a corrupted active state from a valid encrypted backup.

State history is a rapid recovery layer, not a replacement for encrypted backups.


## RC13 normalized financial mirror

Production requires:

```env
PG_FINANCIAL_MIRROR=true
PG_POOL_MAX=5
```

Verify the mirror without taking the writer lock:

```bash
./financial-mirror-verify.sh
```

If the authenticated active state is valid but the normalized financial mirror has drifted:

```bash
./financial-mirror-rebuild.sh
```

The rebuild script stops Bot/Caddy/Server, acquires the normal PostgreSQL writer advisory lock, rebuilds users/orders/transactions/top-ups from the trusted active state at the same revision, verifies the result, then restarts the stack.

Do not manually edit mirror rows to silence a readiness error.

## RC13 financial mutation journal

Production requires:

```env
PG_FINANCIAL_JOURNAL=true
FINANCIAL_JOURNAL_HMAC_KEY=YOUR_DISTINCT_32_PLUS_CHAR_SECRET
```

Verify the append-only HMAC-protected financial journal without taking the writer lock:

```bash
./financial-journal-verify.sh
```

The journal stores no raw Telegram ID. New wallet changes are rejected unless newly added transaction rows explain the exact balance delta.

There is intentionally no journal “repair” command. A mismatched existing HMAC entry is an integrity incident, not something the application should silently rewrite.


## RC13 order/top-up authority

Production requires:

```env
PG_BUSINESS_AUTHORITY=true
BUSINESS_AUTHORITY_HMAC_KEY=YOUR_DISTINCT_32_PLUS_CHAR_SECRET
```

Verify the HMAC-protected authoritative order/top-up rows without taking the writer lock:

```bash
./business-authority-verify.sh
```

The authority protects order financial identity, provider order mapping, order lifecycle, top-up amount/method/status/reference and pseudonymous customer subject keys.

Account deletion may rotate the pseudonymous subject only through the explicit zero-balance anonymization lifecycle.

There is no normal production “rebuild authority from JSON” button. State rollback and full backup restore may replace authority rows only while the public writer is stopped and the PostgreSQL writer lock is held.
