import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const excluded = new Set(["node_modules", ".git", "data"]);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full); else files.push(full);
  }
}
walk(root);

const failures = [];
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const contractSource = fs.readFileSync(path.join(root, "packages/contracts/src/index.js"), "utf8");
const contractVersion = contractSource.match(/APP_VERSION\s*=\s*"([^"]+)"/)?.[1];
if (!contractVersion || contractVersion !== packageInfo.version) failures.push("package version and APP_VERSION must match");
for (const packageFile of ["apps/api/package.json", "apps/provider-mobile/package.json", "apps/owner-mobile/package.json", "apps/radius-agent/package.json", "apps/telegram-bot/package.json", "packages/contracts/package.json"]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, packageFile), "utf8"));
  if (manifest.version !== packageInfo.version) failures.push(`${packageFile}: version must match the root package`);
}
for (const scriptFile of ["scripts/bootstrap-postgres.sh", "scripts/backup-postgres.sh", "scripts/verify-backup.sh", "scripts/restore-postgres.sh"]) {
  if ((fs.statSync(path.join(root, scriptFile)).mode & 0o111) === 0) failures.push(`${scriptFile}: must be executable`);
}
for (const file of files.filter((item) => /\.(?:js|mjs)$/.test(item))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: ${result.stderr.trim()}`);
}
for (const file of files.filter((item) => /(?:\.json|\.webmanifest)$/.test(item) && !item.endsWith("package-lock.json"))) {
  try { JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { failures.push(`${path.relative(root, file)}: ${error.message}`); }
}

for (const appName of ["provider-web", "owner-web"]) {
  const html = fs.readFileSync(path.join(root, "apps", appName, "index.html"), "utf8");
  const nav = html.match(/<nav class="bottom-nav[\s\S]*?<\/nav>/)?.[0] ?? "";
  const buttons = (nav.match(/class="nav-button/g) ?? []).length;
  if (buttons !== 5) failures.push(`${appName}: expected exactly 5 bottom navigation buttons, found ${buttons}`);
  if (!html.includes('dir="rtl"')) failures.push(`${appName}: RTL direction is missing`);
  if (/\son(?:click|submit|load)=/i.test(html)) failures.push(`${appName}: inline event handlers are not allowed`);
  for (const [icon, size] of [["icon-192.png", 192], ["icon-512.png", 512]]) {
    const iconFile = path.join(root, "apps", appName, "public", "icons", icon);
    if (!fs.existsSync(iconFile)) {
      failures.push(`${appName}: missing ${icon}`);
      continue;
    }
    const bytes = fs.readFileSync(iconFile);
    const valid = bytes.length >= 24
      && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(16) === size
      && bytes.readUInt32BE(20) === size;
    if (!valid) failures.push(`${appName}: ${icon} is not a valid ${size}x${size} PNG`);
  }
}

const providerCss = fs.readFileSync(path.join(root, "apps/provider-web/src/styles.css"), "utf8");
if (!/\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s.test(providerCss)) failures.push("provider-web: bottom navigation is not forced into one five-column row");
const providerUi = [
  fs.readFileSync(path.join(root, "apps/provider-web/index.html"), "utf8"),
  fs.readFileSync(path.join(root, "apps/provider-web/src/app.js"), "utf8")
].join("\n");
const telegramEntrypoints = (providerUi.match(/data-view="telegram"/g) ?? []).length;
const subscriptionEntrypoints = (providerUi.match(/data-view="subscriptions"/g) ?? []).length;
if (telegramEntrypoints !== 1) failures.push(`provider-web: expected one Telegram entrypoint, found ${telegramEntrypoints}`);
if (subscriptionEntrypoints !== 1) failures.push(`provider-web: subscription must be accessible only from the fixed top strip; found ${subscriptionEntrypoints} entrypoints`);
for (const required of ['id="demo-login"', 'id="dev-login"', "state.meta.devAuthAvailable"]) {
  if (!providerUi.includes(required)) failures.push(`provider-web: demo login is missing ${required}`);
}

for (const appName of ["provider-mobile", "owner-mobile"]) {
  const appRoot = path.join(root, "apps", appName);
  const manifest = fs.readFileSync(path.join(appRoot, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const gradle = fs.readFileSync(path.join(appRoot, "android/app/build.gradle"), "utf8");
  const networkSecurity = fs.readFileSync(path.join(appRoot, "android/app/src/main/res/xml/network_security_config.xml"), "utf8");
  if (!manifest.includes('android:allowBackup="false"')) failures.push(`${appName}: Android backup must be disabled`);
  if (!manifest.includes('android:usesCleartextTraffic="false"')) failures.push(`${appName}: Android cleartext traffic must be disabled`);
  if (!networkSecurity.includes('cleartextTrafficPermitted="false"')) failures.push(`${appName}: network security must reject cleartext traffic`);
  for (const required of ["ANDROID_KEYSTORE_PATH", "minifyEnabled true", "shrinkResources true", "debuggable false"]) {
    if (!gradle.includes(required)) failures.push(`${appName}: release Gradle configuration is missing ${required}`);
  }
  const nativeAssetDirectory = appName === "provider-mobile" ? "assets" : "src";
  for (const required of [`${nativeAssetDirectory}/native-auth.js`, `${nativeAssetDirectory}/capacitor-core.js`]) {
    if (!fs.existsSync(path.join(appRoot, "www", required))) failures.push(`${appName}: prepared native asset is missing ${required}`);
  }
  if (appName === "provider-mobile" && fs.existsSync(path.join(appRoot, "www/index.html"))) {
    const providerMobileHtml = fs.readFileSync(path.join(appRoot, "www/index.html"), "utf8");
    if (!providerMobileHtml.includes('name="uchiha-runtime" content="native"')) failures.push("provider-mobile: V1-83 native runtime marker is missing");
    for (const forbidden of ["chatgpt.site", "railway.app", "radius.example.com"]) {
      if (providerMobileHtml.toLowerCase().includes(forbidden)) failures.push(`provider-mobile: forbidden runtime host ${forbidden}`);
    }
  }
  const pngFiles = files.filter((file) => file.startsWith(path.join(appRoot, "android/app/src/main/res")) && file.endsWith(".png"));
  for (const pngFile of pngFiles) {
    const bytes = fs.readFileSync(pngFile);
    const validSignature = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const validDimensions = validSignature && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
    if (!validDimensions) failures.push(`${path.relative(root, pngFile)}: invalid or empty PNG`);
  }
}

const migration = fs.readFileSync(path.join(root, "infra/postgres/migrations/001_initial.sql"), "utf8");
for (const required of ["ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY", "app.has_tenant_access", "idempotency_records", "audit_logs"]) {
  if (!migration.includes(required)) failures.push(`PostgreSQL migration missing ${required}`);
}
const billingMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/002_billing_checkout.sql"), "utf8");
for (const required of ["checkout_url", "checkout_expires_at", "IF NOT EXISTS"]) {
  if (!billingMigration.includes(required)) failures.push(`PostgreSQL billing migration missing ${required}`);
}
const subscriptionMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/003_subscription_invariants.sql"), "utf8");
for (const required of ["ROW_NUMBER()", "status = 'canceled'", "UNIQUE INDEX IF NOT EXISTS", "WHERE status = 'pending'"]) {
  if (!subscriptionMigration.includes(required)) failures.push(`PostgreSQL subscription invariant migration missing ${required}`);
}
const operationalMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/004_operational_domains.sql"), "utf8");
for (const required of ["network_sites", "ip_pools", "radius_policies", "voucher_batches", "vouchers", "support_tickets", "radius_accounting_events", "radius_auth_events", "ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY"]) {
  if (!operationalMigration.includes(required)) failures.push(`PostgreSQL operational migration missing ${required}`);
}
const radiusNodeMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/005_radius_nodes.sql"), "utf8");
for (const required of ["CURRENT_USER = 'uchiha_platform'", "radius_nodes", "ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY"]) {
  if (!radiusNodeMigration.includes(required)) failures.push(`PostgreSQL RADIUS node migration missing ${required}`);
}
const customerBillingMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/006_customer_billing.sql"), "utf8");
for (const required of ["period_start", "period_end", "void_reason", "UNIQUE INDEX"]) {
  if (!customerBillingMigration.includes(required)) failures.push(`PostgreSQL customer billing migration missing ${required}`);
}
const alertResolutionMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/007_alert_resolution.sql"), "utf8");
for (const required of ["resolved_by_user_id", "resolved_at", "IF NOT EXISTS"]) {
  if (!alertResolutionMigration.includes(required)) failures.push(`PostgreSQL alert resolution migration missing ${required}`);
}
const maintenanceMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/008_maintenance_indexes.sql"), "utf8");
for (const required of ["auth_sessions_expires_idx", "connector_nonces_expires_idx", "webhook_events_processed_idx", "radius_accounting_received_idx"]) {
  if (!maintenanceMigration.includes(required)) failures.push(`PostgreSQL maintenance migration missing ${required}`);
}
const backupRoleMigration = fs.readFileSync(path.join(root, "infra/postgres/migrations/009_backup_role_access.sql"), "utf8");
for (const required of ["uchiha_platform", "uchiha_backup", "app.has_tenant_access"]) {
  if (!backupRoleMigration.includes(required)) failures.push(`PostgreSQL backup-role migration missing ${required}`);
}
const radiusAgentSource = [
  fs.readFileSync(path.join(root, "apps/radius-agent/src/index.js"), "utf8"),
  fs.readFileSync(path.join(root, "apps/radius-agent/src/directory.js"), "utf8")
].join("\n");
for (const required of ["RADIUS_AGENT_CACHE_KEY", "timingSafeEqual", "radius_directory", "/authorize", "/authenticate", "/post-auth", "/auth-events"]) {
  if (!radiusAgentSource.includes(required)) failures.push(`RADIUS agent authentication path missing ${required}`);
}

const trackedText = files.filter((file) => !/package-lock\.json$/.test(file) && fs.statSync(file).size < 1_000_000).map((file) => fs.readFileSync(file, "utf8")).join("\n");
for (const pattern of [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /(?:telegram|bot)[_-]?token\s*=\s*[1-9][0-9]{6,}:[A-Za-z0-9_-]{20,}/i]) {
  if (pattern.test(trackedText)) failures.push(`possible committed secret matched ${pattern}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Static checks passed for ${files.length} project files.`);
