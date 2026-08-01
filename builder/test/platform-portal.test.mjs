import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { seedEnvironment } from "../src/seed.mjs";

function cookie(response) {
  return String(response.headers["set-cookie"] || "").split(";")[0];
}

async function setup() {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    DEMO_SEED: "true",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    RATE_LIMIT_ENABLED: "false",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "builder.test",
    PLATFORM_WHATSAPP_NUMBER: "+963942586044",
    PLATFORM_ADMIN_EMAIL: "portal-admin@example.test",
    PLATFORM_ADMIN_PASSWORD: "Portal-Admin-Password-2026!"
  });
  config.offerSeed = {
    name: "Portal Test",
    priceMinor: 0,
    renewalPriceMinor: 0,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 7
  };
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  await app.ready();
  return { app, db, config };
}

async function adminSession(app, config) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: config.platformAdminEmail, password: config.platformAdminPassword }
  });
  assert.equal(response.statusCode, 200, response.body);
  return { cookie: cookie(response), csrf: response.json().csrfToken };
}

test("public portal is bilingual, neutral, data-backed and tenant-scoped", async (context) => {
  const { app, db } = await setup();
  context.after(async () => { await app.close(); await db.close(); });

  const response = await app.inject({ method: "GET", url: "/api/public/portal" });
  assert.equal(response.statusCode, 200, response.body);
  const portal = response.json();
  assert.equal(portal.whatsappNumber, "+963942586044");
  assert.deepEqual(portal.supportedLocales, ["ar", "en"]);
  assert.equal(portal.services.length, 14);
  assert.equal(portal.banners.length, 3);
  assert.equal(portal.paymentMethods.length, 6);
  assert.ok(portal.portfolio.some((item) => item.type === "demo"));
  assert.ok(portal.services.every((service) => service.name.ar && service.name.en));
  assert.ok(portal.services.every((service) => service.description.ar && service.description.en));
  assert.ok(portal.paymentMethods.every((method) => method.accountIdentifier === null));
  assert.doesNotMatch(response.body, /UCHIHA_PROVIDER_SLOT|credentials_ciphertext|test-mode-no-external-request/i);

  await db.query(
    `INSERT INTO platform_services (
       id, tenant_id, store_id, service_key, slug, name_ar, name_en, status
     ) VALUES (
       '77000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000101',
       '00000000-0000-4000-8000-000000000102',
       'tenant-private-service','tenant-private-service','خدمة خاصة','Private Service','active'
     )`
  );
  const isolated = await app.inject({ method: "GET", url: "/api/public/portal" });
  assert.equal(isolated.statusCode, 200, isolated.body);
  assert.equal(isolated.json().services.some((service) => service.key === "tenant-private-service"), false);
});

test("service requests validate contact data and enforce idempotency", async (context) => {
  const { app, db } = await setup();
  context.after(async () => { await app.close(); await db.close(); });
  const portal = (await app.inject({ method: "GET", url: "/api/public/portal" })).json();
  const service = portal.services[0];
  const payload = {
    serviceId: service.id,
    customerName: "عميل اختبار",
    customerPhone: "+963942586044",
    details: "متجر رقمي مع واجهة عربية وإنجليزية.",
    locale: "ar",
    sourcePage: "/services"
  };

  const missingContact = await app.inject({
    method: "POST", url: "/api/public/service-requests",
    headers: { "idempotency-key": "portal-contact-required" },
    payload: { ...payload, customerPhone: "" }
  });
  assert.equal(missingContact.statusCode, 422, missingContact.body);

  const first = await app.inject({
    method: "POST", url: "/api/public/service-requests",
    headers: { "idempotency-key": "portal-request-stable" }, payload
  });
  assert.equal(first.statusCode, 201, first.body);
  assert.equal(first.json().request.status, "new");

  const duplicate = await app.inject({
    method: "POST", url: "/api/public/service-requests",
    headers: { "idempotency-key": "portal-request-stable" }, payload
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(duplicate.json().request.id, first.json().request.id);

  const mismatch = await app.inject({
    method: "POST", url: "/api/public/service-requests",
    headers: { "idempotency-key": "portal-request-stable" },
    payload: { ...payload, details: "طلب مختلف" }
  });
  assert.equal(mismatch.statusCode, 409, mismatch.body);
  const rows = await db.query("SELECT COUNT(*) AS count FROM service_requests WHERE idempotency_key=$1", ["portal-request-stable"]);
  assert.equal(Number(rows.rows[0].count), 1);
});

test("platform administration requires permission and manages content with redacted audits", async (context) => {
  const { app, db, config } = await setup();
  context.after(async () => { await app.close(); await db.close(); });

  const anonymous = await app.inject({ method: "GET", url: "/api/platform/portal" });
  assert.equal(anonymous.statusCode, 401, anonymous.body);

  const ordinary = await app.inject({
    method: "POST", url: "/api/auth/register",
    payload: { displayName: "Ordinary User", email: "ordinary@example.test", password: "safe-password-12345" }
  });
  assert.equal(ordinary.statusCode, 201, ordinary.body);
  const forbidden = await app.inject({ method: "GET", url: "/api/platform/portal", headers: { cookie: cookie(ordinary) } });
  assert.equal(forbidden.statusCode, 403, forbidden.body);

  const admin = await adminSession(app, config);
  const snapshot = await app.inject({ method: "GET", url: "/api/platform/portal", headers: { cookie: admin.cookie } });
  assert.equal(snapshot.statusCode, 200, snapshot.body);
  assert.equal(snapshot.json().counts.users >= 2, true);
  assert.equal(snapshot.json().services.length, 14);

  const createdProvider = await app.inject({
    method: "POST", url: "/api/platform/providers",
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: {
      internalName: "Wholesale Integration Test Vendor",
      adapterKey: "mock", currency: "USD", testMode: true,
      capabilities: ["catalog", "orders", "webhooks"], status: "active",
      primaryCredential: "provider-credential-kept-out-of-responses",
      webhookSecret: "provider-webhook-secret-for-tests"
    }
  });
  assert.equal(createdProvider.statusCode, 201, createdProvider.body);
  const provider = createdProvider.json().provider;
  assert.match(provider.alias, /^UCHIHA API \d+$/);
  assert.equal(provider.hasPrimaryCredential, true);
  assert.equal(provider.hasWebhookSecret, true);
  assert.doesNotMatch(createdProvider.body, /provider-credential-kept-out-of-responses|provider-webhook-secret-for-tests/);
  const storedProviderSecret = (
    await db.query(
      `SELECT credentials_ciphertext FROM api_provider_credentials
       WHERE provider_id=$1 AND credential_key='primary'`,
      [provider.id]
    )
  ).rows[0].credentials_ciphertext;
  assert.match(storedProviderSecret, /^v1\./);
  assert.doesNotMatch(storedProviderSecret, /provider-credential-kept-out-of-responses/);

  const wrongWebhookSecret = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: { "x-uchiha-webhook-secret": "wrong-secret", "x-uchiha-event-id": "portal-webhook-wrong" },
    payload: { order_id: "external-missing", status: "completed" }
  });
  assert.equal(wrongWebhookSecret.statusCode, 403, wrongWebhookSecret.body);
  const webhook = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: {
      "x-uchiha-webhook-secret": "provider-webhook-secret-for-tests",
      "x-uchiha-event-id": "portal-webhook-unmatched"
    },
    payload: { order_id: "external-missing", status: "completed" }
  });
  assert.equal(webhook.statusCode, 202, webhook.body);
  assert.equal(webhook.json().matched, false);
  const duplicateWebhook = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: {
      "x-uchiha-webhook-secret": "provider-webhook-secret-for-tests",
      "x-uchiha-event-id": "portal-webhook-unmatched"
    },
    payload: { order_id: "external-missing", status: "completed" }
  });
  assert.equal(duplicateWebhook.statusCode, 200, duplicateWebhook.body);
  assert.equal(duplicateWebhook.json().duplicate, true);
  const webhookEvent = (
    await db.query(
      "SELECT payload_digest, outcome FROM provider_webhook_events WHERE provider_id=$1",
      [provider.id]
    )
  ).rows[0];
  assert.match(webhookEvent.payload_digest, /^[0-9a-f]{64}$/);
  assert.equal(webhookEvent.outcome, "unmatched");

  const syncProvider = await app.inject({
    method: "POST", url: `/api/platform/providers/${provider.id}/sync`,
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf }, payload: {}
  });
  assert.equal(syncProvider.statusCode, 200, syncProvider.body);
  const providerService = (
    await db.query("SELECT id FROM api_services WHERE provider_id=$1 ORDER BY id LIMIT 1", [provider.id])
  ).rows[0];
  const demoStore = (
    await db.query("SELECT id, tenant_id FROM stores WHERE slug='demo'")
  ).rows[0];
  const orderId = "88000000-0000-4000-8000-000000000001";
  const providerOrderId = "88000000-0000-4000-8000-000000000002";
  await db.query(
    `INSERT INTO orders (
       id, tenant_id, store_id, order_number, customer_name, channel,
       status, payment_status, total_minor, currency, idempotency_key
     ) VALUES ($1,$2,$3,'WEBHOOK-TEST-1','Webhook Test','web',
               'processing','paid',100,'USD','webhook-order-test')`,
    [orderId, demoStore.tenant_id, demoStore.id]
  );
  await db.query(
    `INSERT INTO provider_orders (
       id, tenant_id, store_id, order_id, provider_id, api_service_id,
       external_order_id, status, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,'external-webhook-match','processing','webhook-provider-order-test')`,
    [providerOrderId, demoStore.tenant_id, demoStore.id, orderId, provider.id, providerService.id]
  );
  const appliedWebhook = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: {
      "x-uchiha-webhook-secret": "provider-webhook-secret-for-tests",
      "x-uchiha-event-id": "portal-webhook-applied"
    },
    payload: { order_id: "external-webhook-match", status: "partial" }
  });
  assert.equal(appliedWebhook.statusCode, 202, appliedWebhook.body);
  assert.equal(appliedWebhook.json().matched, true);
  assert.equal(appliedWebhook.json().status, "partial");
  const updatedOrders = await db.query(
    `SELECT po.status AS provider_status, o.status AS local_status
     FROM provider_orders po JOIN orders o ON o.id=po.order_id WHERE po.id=$1`,
    [providerOrderId]
  );
  assert.equal(updatedOrders.rows[0].provider_status, "partial");
  assert.equal(updatedOrders.rows[0].local_status, "partial");
  const duplicateAppliedWebhook = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: {
      "x-uchiha-webhook-secret": "provider-webhook-secret-for-tests",
      "x-uchiha-event-id": "portal-webhook-applied"
    },
    payload: { order_id: "external-webhook-match", status: "partial" }
  });
  assert.equal(duplicateAppliedWebhook.statusCode, 200, duplicateAppliedWebhook.body);
  assert.equal(duplicateAppliedWebhook.json().duplicate, true);
  const mismatchedWebhook = await app.inject({
    method: "POST", url: provider.webhookUrl,
    headers: {
      "x-uchiha-webhook-secret": "provider-webhook-secret-for-tests",
      "x-uchiha-event-id": "portal-webhook-applied"
    },
    payload: { order_id: "external-webhook-match", status: "failed" }
  });
  assert.equal(mismatchedWebhook.statusCode, 409, mismatchedWebhook.body);
  assert.equal(mismatchedWebhook.json().error, "webhook_idempotency_mismatch");
  const terminalOrder = await db.query("SELECT status FROM provider_orders WHERE id=$1", [providerOrderId]);
  assert.equal(terminalOrder.rows[0].status, "partial");
  const operationalSnapshot = await app.inject({
    method: "GET", url: "/api/platform/portal", headers: { cookie: admin.cookie }
  });
  assert.equal(operationalSnapshot.statusCode, 200, operationalSnapshot.body);
  assert.equal(
    operationalSnapshot.json().providerOrders.find((item) => item.id === providerOrderId).status,
    "partial"
  );
  assert.ok(operationalSnapshot.json().providerCatalog.some((item) => item.providerAlias === provider.alias));
  assert.ok(operationalSnapshot.json().providerSyncLogs.some((item) => item.providerId === provider.id));

  const library = await app.inject({
    method: "GET", url: "/api/library/providers", headers: { cookie: cookie(ordinary) }
  });
  assert.equal(library.statusCode, 200, library.body);
  assert.doesNotMatch(library.body, /Wholesale Integration Test Vendor|baseUrl|adapterKey/i);

  const created = await app.inject({
    method: "POST", url: "/api/platform/services",
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: {
      serviceKey: "quality-assurance", slug: "quality-assurance", iconKey: "shield",
      nameAr: "ضمان الجودة", nameEn: "Quality Assurance",
      descriptionAr: "اختبارات عملية قبل التسليم.", descriptionEn: "Practical verification before delivery.",
      featuresAr: ["اختبار واجهة", "اختبار صلاحيات"], featuresEn: ["UI testing", "Permission testing"],
      status: "active", sortOrder: 150
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const serviceId = created.json().service.id;

  const hidden = await app.inject({
    method: "PUT", url: `/api/platform/services/${serviceId}`,
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: { status: "hidden" }
  });
  assert.equal(hidden.statusCode, 200, hidden.body);
  const publicPortal = (await app.inject({ method: "GET", url: "/api/public/portal" })).json();
  assert.equal(publicPortal.services.some((service) => service.id === serviceId), false);

  const disguisedExecutable = await app.inject({
    method: "POST", url: "/api/platform/payment-methods",
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: {
      key: "unsafe-upload", type: "manual",
      logoUrl: `data:image/png;base64,${Buffer.alloc(64, "MZ").toString("base64")}`,
      nameAr: "ملف غير آمن", nameEn: "Unsafe File", currency: "USD", status: "hidden"
    }
  });
  assert.equal(disguisedExecutable.statusCode, 422, disguisedExecutable.body);
  assert.equal(disguisedExecutable.json().error, "invalid_asset_content");

  const payment = await app.inject({
    method: "POST", url: "/api/platform/payment-methods",
    headers: { cookie: admin.cookie, "x-csrf-token": admin.csrf },
    payload: {
      key: "test-generated-qr", type: "crypto", logoUrl: "/assets/payment-assets/usdt.svg",
      nameAr: "طريقة اختبار QR", nameEn: "QR Test Method", currency: "USDT", network: "TRC20",
      beneficiaryName: "Portal Test", accountIdentifier: "TTestAddress123456789",
      qrMode: "generated", qrData: "TTestAddress123456789", status: "active", sortOrder: 999,
      instructionAr: "حوّل عبر شبكة TRC20 فقط.", instructionEn: "Use the TRC20 network only.",
      warningAr: "لا تستخدم شبكة مختلفة.", warningEn: "Do not use another network."
    }
  });
  assert.equal(payment.statusCode, 201, payment.body);
  const method = payment.json().paymentMethod;
  assert.match(method.qrUrl, /\/qr\.svg$/);
  assert.equal(method.instructions.find((item) => item.locale === "ar").body, "حوّل عبر شبكة TRC20 فقط.");
  const qr = await app.inject({ method: "GET", url: method.qrUrl });
  assert.equal(qr.statusCode, 200, qr.body);
  assert.match(qr.headers["content-type"], /image\/svg\+xml/);
  assert.match(qr.body, /<svg/);
  assert.match(qr.headers["cache-control"], /no-store/);

  const audits = await db.query(
    "SELECT after_data FROM platform_audit_logs WHERE entity_type='platform_payment_method' ORDER BY created_at DESC LIMIT 1"
  );
  assert.equal(audits.rows[0].after_data.account_identifier, "<configured>");
  assert.equal(audits.rows[0].after_data.qr_data, "<configured>");
});

test("portal surfaces include RTL/LTR, light/dark, mobile, WhatsApp, QR and professional loader contracts", async () => {
  const [marketing, marketingCss, i18n, store, storeApp, platformAdmin, previewBanner, previewCss, packageJson, portalMigration, portalRls] = await Promise.all([
    readFile(new URL("../public/marketing.js", import.meta.url), "utf8"),
    readFile(new URL("../public/marketing.css", import.meta.url), "utf8"),
    readFile(new URL("../public/i18n.js", import.meta.url), "utf8"),
    readFile(new URL("../public/store.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/platform-admin.html", import.meta.url), "utf8"),
    readFile(new URL("../public/preview-banner.js", import.meta.url), "utf8"),
    readFile(new URL("../public/uchiha-showcase-preview.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../migrations/020_platform_portal.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/021_platform_portal_rls.sql", import.meta.url), "utf8")
  ]);
  assert.match(marketing, /documentElement\.dir = state\.locale === "ar" \? "rtl" : "ltr"/);
  assert.match(marketing, /localStorage\.setItem\(LANGUAGE_KEY/);
  assert.match(marketing, /customer_name/);
  assert.match(marketing, /customer_id/);
  assert.match(marketing, /page_url/);
  assert.match(marketing, /https:\/\/wa\.me\//);
  assert.match(marketingCss, /:root\[data-theme="dark"\]/);
  assert.match(marketingCss, /\[dir="ltr"\]/);
  assert.match(marketingCss, /@media \(max-width:/);
  assert.match(i18n, /MutationObserver/);
  assert.match(i18n, /uchiha-ui-language/);
  assert.doesNotMatch(store, /جاري تجهيز المتجر/);
  assert.match(store, /store-loader-orbit/);
  assert.match(store, /brand\/storefront-mark\.svg/);
  assert.match(store, /storeFloatingWhatsapp/);
  assert.match(store, /963942586044/);
  assert.match(storeApp, /startBannerAutoplay/);
  assert.match(storeApp, /catalog\.banners/);
  assert.match(platformAdmin, /data-language-toggle/);
  assert.match(platformAdmin, /data-theme-toggle/);
  assert.match(platformAdmin, /platformContent/);
  assert.doesNotMatch(previewBanner, /demoCategories|أهلًا بك في عالم الأوتشيها|previewNetBalance/);
  assert.doesNotMatch(previewCss, /showcase-red|uchiha-mark|content:\s*["']UCHIHA/);
  assert.equal(JSON.parse(packageJson).dependencies.qrcode, "1.5.4");
  assert.match(portalMigration, /provider_sync_logs_scope_check/);
  assert.match(portalRls, /FOREIGN KEY \(store_id, tenant_id\) REFERENCES stores\(id, tenant_id\)/);
  assert.match(portalRls, /provider_order_attempts_store_scope_fk/);
  assert.match(portalRls, /ALTER TABLE service_requests FORCE ROW LEVEL SECURITY/);
  assert.match(portalRls, /CREATE POLICY provider_webhook_events_scope/);
});

test("all public portal and legal pages render from their real routes", async (context) => {
  const { app, db } = await setup();
  context.after(async () => { await app.close(); await db.close(); });
  for (const path of ["/", "/services", "/contact", "/support", "/payment-methods", "/uchiha-api", "/showcase", "/terms", "/privacy", "/platform-admin", "/create-store", "/login", "/account"]) {
    const response = await app.inject({ method: "GET", url: path });
    assert.equal(response.statusCode, 200, `${path}: ${response.body}`);
    assert.match(response.headers["content-type"] || "", /text\/html/);
  }
});
