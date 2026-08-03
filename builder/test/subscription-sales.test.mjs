import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";
import { installLaunchSubscriptionAdminRoutes } from "../src/launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "../src/launch-subscriptions.mjs";
import { createDatabase } from "../src/db.mjs";
import { seedEnvironment } from "../src/seed.mjs";

test("launch sales assets are injected into customer and admin pages", async () => {
  const [assets, customerJs, adminJs, start] = await Promise.all([
    readFile(new URL("../src/launch-assets.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/launch-builder-sales.js", import.meta.url), "utf8"),
    readFile(new URL("../public/launch-admin-sales.js", import.meta.url), "utf8"),
    readFile(new URL("../src/start.mjs", import.meta.url), "utf8")
  ]);
  assert.match(assets, /\/create-store/);
  assert.match(assets, /\/platform-admin/);
  assert.match(assets, /launch-builder-sales\.js/);
  assert.match(assets, /launch-admin-sales\.js/);
  assert.match(customerJs, /launchSubscriptionForm/);
  assert.match(customerJs, /\/api\/subscription-requests/);
  assert.match(customerJs, /visibilitychange/);
  assert.match(adminJs, /data-section="subscriptions"/);
  assert.match(adminJs, /\/api\/platform\/subscription-requests/);
  assert.match(start, /installLaunchAssetInjection/);
  assert.match(start, /installLaunchSubscriptionRoutes/);
  assert.match(start, /installLaunchSubscriptionAdminRoutes/);
});

function cookie(response) {
  return String(response.headers["set-cookie"] || "").split(";")[0];
}

async function setup() {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    ALLOW_DEMO_BILLING: "false",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    RATE_LIMIT_ENABLED: "false",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "uchiha.store",
    PLATFORM_ADMIN_EMAIL: "launch-admin@example.test",
    PLATFORM_ADMIN_PASSWORD: "Launch-Admin-Password-2026!"
  });
  config.offerSeed = {
    name: "UCHIHA Full Launch",
    priceMinor: 2500,
    renewalPriceMinor: 2500,
    currency: "USD",
    durationUnit: "month",
    durationCount: 1,
    trialDays: 0
  };
  const db = await createDatabase(config);
  await seedEnvironment(db, config);
  await db.query(
    `UPDATE platform_payment_methods
     SET status='active', account_identifier='TEST-DESTINATION', beneficiary_name='UCHIHA Test'
     WHERE method_key='binance-pay'`
  );
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  installLaunchSubscriptionRoutes(app, { db, config });
  installLaunchSubscriptionAdminRoutes(app, { db, config });
  installLaunchAssetInjection(app);
  await app.ready();
  return { app, db, config };
}

test("manual payment approval unlocks exactly one store creation", async (context) => {
  const { app, db, config } = await setup();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const builderPage = await app.inject({ method: "GET", url: "/create-store" });
  assert.equal(builderPage.statusCode, 200, builderPage.body);
  assert.match(builderPage.body, /launch-builder-sales\.js/);
  const adminPage = await app.inject({ method: "GET", url: "/platform-admin" });
  assert.equal(adminPage.statusCode, 200, adminPage.body);
  assert.match(adminPage.body, /launch-admin-sales\.js/);

  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      displayName: "Launch Owner",
      email: "launch-owner@example.test",
      password: "launch-owner-password-2026"
    }
  });
  assert.equal(register.statusCode, 201, register.body);
  const ownerCookie = cookie(register);
  const ownerCsrf = register.json().csrfToken;

  const portal = await app.inject({ method: "GET", url: "/api/public/portal" });
  const paymentMethod = portal.json().paymentMethods.find((item) => item.key === "binance-pay");
  assert.equal(paymentMethod.status, "active");
  assert.equal(paymentMethod.configured, true);

  const activation = await app.inject({
    method: "POST",
    url: "/api/subscription-requests",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "launch-subscription-request-1"
    },
    payload: {
      paymentMethodId: paymentMethod.id,
      reference: "BINANCE-REFERENCE-001",
      note: "Manual launch verification"
    }
  });
  assert.equal(activation.statusCode, 201, activation.body);
  assert.equal(activation.json().request.status, "new");

  const secondRegister = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      displayName: "Second Launch Owner",
      email: "second-launch-owner@example.test",
      password: "second-launch-owner-password-2026"
    }
  });
  assert.equal(secondRegister.statusCode, 201, secondRegister.body);
  const reusedReference = await app.inject({
    method: "POST",
    url: "/api/subscription-requests",
    headers: {
      cookie: cookie(secondRegister),
      "x-csrf-token": secondRegister.json().csrfToken,
      "idempotency-key": "launch-subscription-request-second-user"
    },
    payload: {
      paymentMethodId: paymentMethod.id,
      reference: "BINANCE-REFERENCE-001"
    }
  });
  assert.equal(reusedReference.statusCode, 409, reusedReference.body);
  assert.equal(reusedReference.json().error, "payment_reference_used");

  const duplicate = await app.inject({
    method: "POST",
    url: "/api/subscription-requests",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "launch-subscription-request-2"
    },
    payload: {
      paymentMethodId: paymentMethod.id,
      reference: "BINANCE-REFERENCE-001",
      note: "Manual launch verification"
    }
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(duplicate.json().request.id, activation.json().request.id);

  const beforeApproval = await app.inject({
    method: "GET",
    url: "/api/subscription-status",
    headers: { cookie: ownerCookie }
  });
  assert.equal(beforeApproval.statusCode, 200, beforeApproval.body);
  assert.equal(beforeApproval.json().subscription, null);
  assert.equal(beforeApproval.json().request.status, "new");
  assert.equal(beforeApproval.json().offer.name, "UCHIHA Full Launch");

  const adminLogin = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: config.platformAdminEmail, password: config.platformAdminPassword }
  });
  assert.equal(adminLogin.statusCode, 200, adminLogin.body);
  const adminCookie = cookie(adminLogin);
  const adminCsrf = adminLogin.json().csrfToken;

  const adminSnapshot = await app.inject({
    method: "GET",
    url: "/api/platform/subscription-requests",
    headers: { cookie: adminCookie }
  });
  assert.equal(adminSnapshot.statusCode, 200, adminSnapshot.body);
  const request = adminSnapshot.json().requests.find((item) => item.id === activation.json().request.id);
  assert.equal(request.metadata.requestType, "subscription_activation");
  assert.equal(request.metadata.paymentReference, "BINANCE-REFERENCE-001");

  const approve = await app.inject({
    method: "POST",
    url: `/api/platform/subscription-requests/${request.id}/review`,
    headers: { cookie: adminCookie, "x-csrf-token": adminCsrf },
    payload: { decision: "approve" }
  });
  assert.equal(approve.statusCode, 200, approve.body);
  assert.equal(approve.json().request.status, "completed");
  assert.equal(approve.json().subscription.status, "active");

  const duplicateApproval = await app.inject({
    method: "POST",
    url: `/api/platform/subscription-requests/${request.id}/review`,
    headers: { cookie: adminCookie, "x-csrf-token": adminCsrf },
    payload: { decision: "approve" }
  });
  assert.equal(duplicateApproval.statusCode, 200, duplicateApproval.body);
  assert.equal(duplicateApproval.json().duplicate, true);
  const subscriptionCount = await db.query(
    "SELECT count(*) AS count FROM subscriptions WHERE user_id=$1 AND tenant_id IS NULL",
    [request.userId]
  );
  assert.equal(Number(subscriptionCount.rows[0].count), 1);

  const createStore = await app.inject({
    method: "POST",
    url: "/api/stores",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "launch-create-store-1"
    },
    payload: {
      name: "Launch Store",
      slug: "launch-store",
      activityType: "digital-products",
      description: "Launch-ready digital store",
      country: "Syria",
      language: "ar",
      currency: "USD",
      templateKey: "modern-light",
      primaryColor: "#5b52c9",
      secondaryColor: "#1c1a23",
      backgroundColor: "#f8f7fb",
      surfaceColor: "#ffffff",
      textColor: "#1b1821",
      mutedTextColor: "#706c79",
      borderColor: "#e4e1e8",
      components: ["store_website", "web_admin"],
      bannerMediaType: "abstract"
    }
  });
  assert.equal(createStore.statusCode, 202, createStore.body);
  assert.equal(createStore.json().store.slug, "launch-store");

  const consumed = await db.query(
    "SELECT tenant_id, status, activation_mode FROM subscriptions WHERE id=$1",
    [approve.json().subscription.id]
  );
  assert.ok(consumed.rows[0].tenant_id);
  assert.equal(consumed.rows[0].status, "active");
  assert.equal(consumed.rows[0].activation_mode, "payment");
});
