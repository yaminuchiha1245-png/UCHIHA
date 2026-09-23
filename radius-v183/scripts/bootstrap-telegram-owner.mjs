// Trusted root-only bootstrap of the existing bot owner into an EMPTY V1-83 staging database.
// No mock subscribers, routers, sessions, invoices, or payments are inserted.
import fs from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

function readSetting(file, key) {
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find(x => x.startsWith(key + "="));
  if (!line) throw Error("Missing private deployment setting: " + key);
  return line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
}
const { V183_ADMIN_ENV_FILE, V183_BOT_OWNER_ENV_FILE, V183_BOOTSTRAP_STAGING } = process.env;
if (process.getuid?.() !== 0 || V183_BOOTSTRAP_STAGING !== "yes" ||
    !V183_ADMIN_ENV_FILE || !V183_BOT_OWNER_ENV_FILE) {
  throw Error("Explicit root-only staging authorization is required.");
}
const telegramId = readSetting(V183_BOT_OWNER_ENV_FILE, "UCHIHA_RADIUS_OWNER_TELEGRAM_ID");
if (!/^[1-9]\d{3,16}$/.test(telegramId) || !Number.isSafeInteger(Number(telegramId))) {
  throw Error("Paired Telegram owner ID is invalid.");
}
const url = readSetting(V183_ADMIN_ENV_FILE, "MIGRATION_DATABASE_URL");
if (!/^postgres(ql)?:\/\//.test(url)) throw Error("Missing trusted migration-role connection.");
const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 6000 });
await db.connect();
try {
  await db.query("BEGIN");
  try {
    const linked = await db.query("SELECT 1 FROM telegram_accounts WHERE telegram_user_id=$1", [telegramId]);
    if (linked.rowCount) {
      await db.query("ROLLBACK");
      console.log("OWNER_BOOTSTRAP=already_linked");
    } else {
      const counts = (await db.query("SELECT (SELECT COUNT(*)::integer FROM users) AS users, (SELECT COUNT(*)::integer FROM tenants) AS tenants, (SELECT COUNT(*)::integer FROM memberships) AS members, (SELECT COUNT(*)::integer FROM subscribers) AS subscribers")).rows[0];
      if (Object.values(counts).some(x => x !== 0)) throw Error("Nonempty database; manual migration is needed.");
      const now = new Date().toISOString();
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const user = "usr_" + randomUUID();
      const tenant = "ten_" + randomUUID();
      const product = "prd_" + randomUUID();
      const opaqueEmail = createHash("sha256").update(telegramId).digest("hex").slice(0, 16);
      await db.query("INSERT INTO users (id,email,google_sub,display_name,avatar_url,platform_role,created_at,updated_at) VALUES ($1,$2,NULL,'مالك UCHIHA RADIUS',NULL,'platform_owner',$3,$3)", [user, "telegram-" + opaqueEmail + "@internal.uchiha.invalid", now]);
      await db.query("INSERT INTO tenants (id,name,slug,currency,time_zone,status,created_at,updated_at) VALUES ($1,'UCHIHA RADIUS','uchiha-radius-v183','USD','UTC','active',$2,$2)", [tenant, now]);
      await db.query("INSERT INTO memberships (id,tenant_id,user_id,role,status,created_at,updated_at) VALUES ($1,$2,$3,'owner','active',$4,$4)", ["mem_" + randomUUID(), tenant, user, now]);
      await db.query("INSERT INTO telegram_accounts (telegram_user_id,user_id,status,created_at,updated_at) VALUES ($1,$2,'active',$3,$3)", [telegramId, user, now]);
      await db.query("INSERT INTO subscription_products (id,code,name_ar,price_minor,currency,billing_period,limits_json,active,created_at,updated_at) VALUES ($1,'internal-v183-trial','تجربة تقنية داخلية',0,'USD','monthly',$2::jsonb,true,$3,$3)", [product, JSON.stringify({subscribers:250,devices:10,team:3}), now]);
      await db.query("INSERT INTO tenant_subscriptions (id,tenant_id,product_id,status,provider,external_id,starts_at,ends_at,created_at,updated_at) VALUES ($1,$2,$3,'trialing','internal-staging','v183-internal-only',$4,$5,$4,$4)", ["sub_" + randomUUID(), tenant, product, now, until]);
      await db.query("COMMIT");
      console.log("OWNER_BOOTSTRAP=linked_to_existing_bot_owner");
      console.log("STAGING_TRIAL_DAYS=7");
      console.log("SUBSCRIBERS=0;ROUTERS=0;BILLING_REAL=no");
    }
  } catch (error) { await db.query("ROLLBACK"); throw error; }
} finally { await db.end(); }
