#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="${UCHIHA_ROOT_DIR:-/opt/uchiha-builder}"
ENV_FILE="${UCHIHA_ENV_FILE:-$ROOT_DIR/.env}"
POSTGRES_CONTAINER="${UCHIHA_POSTGRES_CONTAINER:-uchiha-postgres}"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

env_value() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
POSTGRES_USER="$(env_value POSTGRES_USER)"
POSTGRES_DB="$(env_value POSTGRES_DB)"
POSTGRES_PASSWORD="$(env_value POSTGRES_PASSWORD)"
[[ -n "$POSTGRES_USER" && -n "$POSTGRES_DB" && -n "$POSTGRES_PASSWORD" ]] || { echo "PostgreSQL environment is incomplete" >&2; exit 1; }
docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || { echo "PostgreSQL container is unavailable" >&2; exit 1; }

dbq() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "$1"
}

bot_violations="$(dbq "SELECT count(*) FROM bot_connections bc JOIN tenants t ON t.id=bc.tenant_id WHERE bc.status='active' AND t.status <> 'active' AND NOT (t.status='connecting_bots' AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id=t.id AND s.status IN ('trial','active') AND s.ends_at>NOW()) AND EXISTS (SELECT 1 FROM provisioning_jobs j WHERE j.tenant_id=t.id AND j.store_id=bc.store_id AND j.job_type IN ('connect_bots','publish_store') AND j.status='running' AND j.claim_token IS NOT NULL AND j.lease_expires_at>NOW()));" 2>/dev/null || echo 999)"
[[ "$bot_violations" == 0 ]] || { echo "$bot_violations active bot connection(s) violate tenant/provisioning state" >&2; exit 1; }
printf 'PASS active bots are limited to active tenants or live leased provisioning\n'

subscription_payment_mismatches="$(dbq "SELECT count(*) FROM service_requests sr WHERE sr.metadata->>'requestType' IN ('subscription_activation','subscription_renewal') AND sr.status NOT IN ('completed','cancelled','rejected') AND (COALESCE(sr.metadata->>'amountMinor','') !~ '^[0-9]+$' OR NOT EXISTS (SELECT 1 FROM platform_payment_methods pm WHERE pm.id::text=sr.metadata->>'paymentMethodId' AND pm.tenant_id IS NULL AND pm.store_id IS NULL AND pm.status='active' AND (pm.account_identifier IS NOT NULL OR pm.qr_data IS NOT NULL OR pm.qr_image_url IS NOT NULL) AND upper(COALESCE(pm.currency,''))=upper(COALESCE(sr.metadata->>'currency','')) AND (pm.minimum_amount_minor IS NULL OR (CASE WHEN COALESCE(sr.metadata->>'amountMinor','') ~ '^[0-9]+$' THEN (sr.metadata->>'amountMinor')::bigint ELSE -1 END)>=pm.minimum_amount_minor) AND (pm.maximum_amount_minor IS NULL OR (CASE WHEN COALESCE(sr.metadata->>'amountMinor','') ~ '^[0-9]+$' THEN (sr.metadata->>'amountMinor')::bigint ELSE -1 END)<=pm.maximum_amount_minor)));" 2>/dev/null || echo 999)"
if [[ "$subscription_payment_mismatches" == 0 ]]; then
  printf 'PASS pending subscription proofs match active payment currency and min/max limits\n'
else
  printf 'WARN %s pending subscription request(s) need payment re-review; migration 050 blocks unsafe approval\n' "$subscription_payment_mismatches" >&2
fi
