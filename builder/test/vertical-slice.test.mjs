import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { buildApp } from "../src/app.mjs";
import { ensureShowcaseStore, seedEnvironment } from "../src/seed.mjs";
import { decryptSecret } from "../src/security.mjs";
import { runProvisioningOnce, runProviderOrderOnce } from "../src/worker.mjs";

function cookieHeader(response) {
  const raw = response.headers["set-cookie"];
  assert.ok(raw, "authentication must set a session cookie");
  return raw.split(";")[0];
}

function json(response) {
  return response.json();
}

async function setup() {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    ALLOW_DEMO_BILLING: "true",
    TELEGRAM_MODE: "fake",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "uchiha.store",
    COOKIE_SECURE: "false",
    UCHIHA_API_1_MODE: "test"
  });
  config.offerSeed = {
    name: "UCHIHA Full Test",
    priceMinor: 4321,
    renewalPriceMinor: 4000,
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

test("production demo deployment receives safe staging defaults without hard-coded billing", () => {
  const environment = {
    NODE_ENV: "production",
    DATABASE_MODE: "postgres",
    DATABASE_URL: "postgresql://uchiha:temporary@postgres:5432/uchiha_builder",
    DEMO_SEED: "true",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64")
  };
  const first = loadConfig(environment);
  const second = loadConfig(environment);
  assert.equal(first.allowDemoBilling, true);
  assert.equal(first.telegramMode, "fake");
  assert.equal(first.appBaseUrl, "");
  assert.deepEqual(first.encryptionKey, Buffer.alloc(32, 7));
  assert.deepEqual(first.encryptionKey, second.encryptionKey);
  assert.equal(first.encryptionKey.length, 32);
});

test("production demo deployment starts safely before Railway links PostgreSQL", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PREVIEW_MEMORY_MODE: "true",
    REQUIRE_PERSISTENT_DATABASE: "false",
    DEMO_SEED: "true"
  });

  assert.equal(config.previewMemoryMode, true);
  assert.equal(config.databaseMode, "memory");
  assert.equal(config.databaseUrl, "");
  assert.equal(config.telegramMode, "fake");
  assert.equal(config.providerMode, "test");
  assert.equal(config.allowDemoBilling, true);
});

test("demo seed exposes a stable public showcase storefront", async (context) => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    APP_BASE_URL: "http://builder.test"
  });
  const db = await createDatabase(config);
  const showcase = await ensureShowcaseStore(db);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  await app.ready();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const storefront = await app.inject({ method: "GET", url: `/api/storefront/${showcase.slug}?limit=3` });
  assert.equal(storefront.statusCode, 200, storefront.body);
  assert.equal(json(storefront).store.name, "Nova Digital");
  assert.equal(json(storefront).categories.length, 7);
  assert.equal(json(storefront).products.length, 3);

  const catalogOnly = await app.inject({
    method: "GET",
    url: `/api/storefront/${showcase.slug}?catalogOnly=1`
  });
  assert.equal(catalogOnly.statusCode, 200, catalogOnly.body);
  assert.equal(json(catalogOnly).categories.length, 7);
  assert.deepEqual(json(catalogOnly).products, []);
  assert.equal(json(catalogOnly).pagination.total, 0);
});

test("UCHIHA Builder vertical slice works end to end with strict tenant isolation", async (context) => {
  const { app, db, config } = await setup();
  context.after(async () => {
    await app.close();
    await db.close();
  });

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(json(health).database, "memory-demo");

  const publicConfig = await app.inject({ method: "GET", url: "/api/public/config" });
  assert.deepEqual(json(publicConfig).templates.map((template) => template.key), [
    "professional-dark",
    "modern-light",
    "gaming-digital"
  ]);
  assert.ok(json(publicConfig).currencies.includes("USD"));
  assert.ok(json(publicConfig).currencies.includes("EUR"));

  const serviceCatalog = await app.inject({ method: "GET", url: "/api/public/service-catalog" });
  assert.equal(serviceCatalog.statusCode, 200, serviceCatalog.body);
  assert.ok(
    json(serviceCatalog).services.some((service) => service.key === "storefront_bot")
  );
  assert.ok(
    json(serviceCatalog).services.some((service) => service.key === "android_app")
  );

  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /UCHIHA Builder/);
  assert.match(home.body, /viewport/);

  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      displayName: "مالك المتجر",
      email: "owner@example.com",
      password: "correct-horse-uchiha"
    }
  });
  assert.equal(register.statusCode, 201, register.body);
  const ownerCookie = cookieHeader(register);
  let ownerCsrf = json(register).csrfToken;

  const offerResponse = await app.inject({ method: "GET", url: "/api/subscription-offer" });
  const offer = json(offerResponse).offer;
  assert.equal(offer.name, "UCHIHA Full Test");
  assert.equal(offer.priceMinor, 4321);
  assert.equal(offer.renewalPriceMinor, 4000);

  const activate = await app.inject({
    method: "POST",
    url: "/api/subscriptions/demo-activate",
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { offerId: offer.id }
  });
  assert.equal(activate.statusCode, 200, activate.body);
  assert.equal(json(activate).subscription.activationMode, "demo");

  const availability = await app.inject({
    method: "GET",
    url: "/api/stores/slug/alpha-store/availability",
    headers: { cookie: ownerCookie }
  });
  assert.equal(json(availability).available, true);

  const createPayload = {
    name: "متجر ألفا",
    slug: "alpha-store",
    activityType: "digital-products",
    description: "متجر تجريبي لمنتجات وخدمات UCHIHA.",
    country: "Türkiye",
    language: "ar",
    currency: "USD",
    templateKey: "digital",
    primaryColor: "#5b21b6",
    secondaryColor: "#111827",
    backgroundColor: "#f5f3ff",
    surfaceColor: "#ffffff",
    textColor: "#1f2937",
    mutedTextColor: "#6b7280",
    logoUrl: "https://example.com/logo.png",
    faviconUrl: "https://example.com/favicon.png",
    phone: "+905555555555",
    whatsapp: "+905555555555",
    telegram: "@alpha_store",
    welcomeMessage: "مرحبًا بك في متجر ألفا",
    components: ["storefront_bot", "admin_bot", "android_app", "ios_app"]
  };
  const invalidBanner = await app.inject({
    method: "POST",
    url: "/api/stores",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "create-invalid-banner-v1"
    },
    payload: {
      ...createPayload,
      bannerMediaType: "video",
      bannerUrl: ""
    }
  });
  assert.equal(invalidBanner.statusCode, 422, invalidBanner.body);
  assert.equal(json(invalidBanner).error, "banner_media_required");
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM stores")).rows[0].count, 0);

  const createStore = await app.inject({
    method: "POST",
    url: "/api/stores",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "create-alpha-v1"
    },
    payload: createPayload
  });
  assert.equal(createStore.statusCode, 202, createStore.body);
  const createResult = json(createStore);
  const created = createResult.store;
  assert.equal(created.slug, "alpha-store");
  assert.equal(created.links.subdomain, "https://alpha-store.uchiha.store");
  assert.equal(createResult.project.type, "mixed");
  assert.deepEqual(createResult.project.components, [
    "store_website",
    "web_admin",
    "storefront_bot",
    "admin_bot",
    "android_app",
    "ios_app"
  ]);

  const projects = await app.inject({
    method: "GET",
    url: "/api/projects",
    headers: { cookie: ownerCookie }
  });
  assert.equal(projects.statusCode, 200, projects.body);
  assert.equal(json(projects).projects.length, 1);
  assert.equal(json(projects).projects[0].components.length, 6);

  const duplicateStore = await app.inject({
    method: "POST",
    url: "/api/stores",
    headers: {
      cookie: ownerCookie,
      "x-csrf-token": ownerCsrf,
      "idempotency-key": "create-alpha-v1"
    },
    payload: createPayload
  });
  assert.equal(duplicateStore.statusCode, 200, duplicateStore.body);
  assert.equal(json(duplicateStore).store.id, created.id);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM stores")).rows[0].count, 1);

  const provision = await runProvisioningOnce(db, config);
  assert.equal(provision.status, "completed");
  let adminStore = await app.inject({
    method: "GET",
    url: `/api/stores/${created.id}`,
    headers: { cookie: ownerCookie }
  });
  assert.equal(adminStore.statusCode, 200, adminStore.body);
  assert.equal(json(adminStore).store.status, "ready_to_publish");
  assert.equal(json(adminStore).store.design.primaryColor, "#5b21b6");
  assert.equal(json(adminStore).store.design.backgroundColor, "#f5f3ff");
  assert.equal(json(adminStore).store.design.textColor, "#1f2937");
  assert.equal(json(adminStore).store.design.logoUrl, "https://example.com/logo.png");
  assert.equal(json(adminStore).store.design.faviconUrl, "https://example.com/favicon.png");
  assert.equal(json(adminStore).store.contacts.telegram, "@alpha_store");
  assert.equal(json(adminStore).project.type, "mixed");
  assert.equal(json(adminStore).project.status, "configuring");
  assert.equal(json(adminStore).project.components.length, 6);
  assert.ok(
    json(adminStore).project.components
      .filter((component) => ["store_website", "web_admin"].includes(component.key))
      .every((component) => component.status === "active")
  );

  const invalidCurrencyRate = await app.inject({
    method: "PUT",
    url: `/api/stores/${created.id}/currencies/EUR`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { rateToBase: 0, isEnabled: true }
  });
  assert.equal(invalidCurrencyRate.statusCode, 422, invalidCurrencyRate.body);

  const addDisplayCurrency = await app.inject({
    method: "PUT",
    url: `/api/stores/${created.id}/currencies/EUR`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { rateToBase: 1.08, isEnabled: true }
  });
  assert.equal(addDisplayCurrency.statusCode, 200, addDisplayCurrency.body);
  assert.equal(json(addDisplayCurrency).currencies.length, 2);
  assert.equal(
    json(addDisplayCurrency).currencies.find((entry) => entry.currency === "EUR").rateToBase,
    1.08
  );

  const updateDesign = await app.inject({
    method: "PUT",
    url: `/api/stores/${created.id}/design`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: {
      templateKey: "professional-dark",
      primaryColor: "#7c3aed",
      secondaryColor: "#0f172a",
      backgroundColor: "#070b14",
      surfaceColor: "#111827",
      textColor: "#f8fafc",
      mutedTextColor: "#94a3b8",
      borderColor: "#263244",
      fontFamily: "Tajawal",
      borderRadius: "20px",
      buttonStyle: "soft",
      cardStyle: "elevated",
      logoUrl: "https://example.com/logo.png",
      coverUrl: "https://example.com/cover.jpg"
    }
  });
  assert.equal(updateDesign.statusCode, 200, updateDesign.body);
  assert.equal(json(updateDesign).store.templateKey, "professional-dark");
  assert.equal(json(updateDesign).store.design.buttonStyle, "soft");
  assert.equal(json(updateDesign).store.design.cardStyle, "elevated");
  assert.equal(json(updateDesign).store.design.coverUrl, "https://example.com/cover.jpg");

  const invalidCategoryImage = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/categories`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { name: "صورة غير آمنة", imageUrl: "http://example.com/category.jpg" }
  });
  assert.equal(invalidCategoryImage.statusCode, 422, invalidCategoryImage.body);
  assert.equal(json(invalidCategoryImage).error, "invalid_image_url");

  const addCategory = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/categories`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { name: "المنتجات الرقمية" }
  });
  assert.equal(addCategory.statusCode, 200, addCategory.body);
  const category = json(addCategory).category;

  const addSubcategory = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/categories`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { name: "خدمات التواصل", parentId: category.id }
  });
  assert.equal(addSubcategory.statusCode, 200, addSubcategory.body);
  const subcategory = json(addSubcategory).category;
  assert.equal(subcategory.parentId, category.id);

  const addProduct = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/products`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: {
      categoryId: subcategory.id,
      productType: "digital",
      name: "بطاقة رقمية تجريبية",
      description: "منتج محلي يظهر من نفس قاعدة البيانات.",
      priceMinor: 950,
      minimumQuantity: 1,
      deliveryMode: "manual",
      mediaKey: "social-service"
    }
  });
  assert.equal(addProduct.statusCode, 200, addProduct.body);
  const localProduct = json(addProduct).product;
  assert.equal(localProduct.imageUrl, "/assets/catalog-assets/social-service.svg");
  assert.deepEqual(localProduct.media, {
    source: "platform",
    key: "social-service",
    locked: false
  });

  const customizeProductMedia = await app.inject({
    method: "PATCH",
    url: `/api/stores/${created.id}/products/${localProduct.id}/media`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: { imageUrl: "https://example.com/custom-product.jpg" }
  });
  assert.equal(customizeProductMedia.statusCode, 200, customizeProductMedia.body);
  assert.equal(json(customizeProductMedia).product.imageUrl, "https://example.com/custom-product.jpg");
  assert.equal(json(customizeProductMedia).product.media.source, "merchant");
  assert.equal(json(customizeProductMedia).product.media.locked, true);

  const preview = await app.inject({
    method: "GET",
    url: "/api/storefront/alpha-store?preview=1",
    headers: { cookie: ownerCookie }
  });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(json(preview).products.length, 1);
  assert.equal(json(preview).categories.length, 2);
  assert.deepEqual(
    json(preview).currencies.map((entry) => entry.currency),
    ["USD", "EUR"]
  );
  assert.equal(
    json(preview).categories.find((item) => item.id === subcategory.id).parentId,
    category.id
  );

  const bots = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/bots`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: {
      storefrontToken: "100001:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
      adminToken: "100002:ABCDEFGHIJKLMNOPQRSTUVWXYZ654321",
      ownerTelegramId: "987654321"
    }
  });
  assert.equal(bots.statusCode, 200, bots.body);
  assert.equal(json(bots).bots.length, 2);
  assert.ok(json(bots).bots.every((bot) => bot.token.startsWith("••••••••")));
  assert.doesNotMatch(bots.body, /ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/);

  const connectBots = await runProvisioningOnce(db, config);
  assert.equal(connectBots.status, "completed");
  adminStore = await app.inject({
    method: "GET",
    url: `/api/stores/${created.id}`,
    headers: { cookie: ownerCookie }
  });
  assert.equal(json(adminStore).store.status, "active");
  assert.ok(json(adminStore).bots.every((bot) => bot.status === "active"));

  const publicStore = await app.inject({ method: "GET", url: "/api/storefront/alpha-store" });
  assert.equal(publicStore.statusCode, 200, publicStore.body);
  assert.equal(json(publicStore).products[0].name, "بطاقة رقمية تجريبية");

  const library = await app.inject({
    method: "GET",
    url: "/api/library/services",
    headers: { cookie: ownerCookie }
  });
  assert.equal(library.statusCode, 200, library.body);
  const libraryServices = json(library).services;
  assert.equal(libraryServices.length, 3);
  assert.ok(libraryServices.every((service) => service.source === "UCHIHA API 1"));
  assert.doesNotMatch(library.body, /JAS4CARD/i);

  const importApi = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/library/import`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: {
      serviceId: libraryServices[0].id,
      newCategoryName: "خدمات UCHIHA",
      name: "شحن سريع وآمن",
      profitMode: "percent",
      profitValue: 15,
      syncEnabled: true
    }
  });
  assert.equal(importApi.statusCode, 200, importApi.body);
  const apiProduct = json(importApi).product;
  assert.equal(apiProduct.type, "api_service");
  assert.equal(apiProduct.sourceKind, "uchiha_api");
  assert.match(apiProduct.imageUrl, /^\/assets\/catalog-assets\//);
  assert.equal(apiProduct.media.locked, false);
  assert.doesNotMatch(importApi.body, /JAS4CARD/i);

  const programmingLibrary = await app.inject({
    method: "GET",
    url: "/api/library/programming-services",
    headers: { cookie: ownerCookie }
  });
  assert.equal(programmingLibrary.statusCode, 200);
  assert.equal(json(programmingLibrary).services.length, 17);

  const importProgramming = await app.inject({
    method: "POST",
    url: `/api/stores/${created.id}/programming-services/import`,
    headers: { cookie: ownerCookie, "x-csrf-token": ownerCsrf },
    payload: {
      serviceId: json(programmingLibrary).services[0].id,
      merchantMarginMinor: 500
    }
  });
  assert.equal(importProgramming.statusCode, 200, importProgramming.body);
  assert.equal(json(importProgramming).product.type, "programming_service");
  assert.equal(json(importProgramming).product.imageUrl, "/assets/catalog-assets/programming.svg");

  const publicAfterImports = await app.inject({
    method: "GET",
    url: "/api/storefront/alpha-store"
  });
  assert.equal(json(publicAfterImports).products.length, 3);
  assert.equal(json(publicAfterImports).pagination.total, 3);

  const firstProductPage = await app.inject({
    method: "GET",
    url: "/api/storefront/alpha-store?limit=1&offset=0"
  });
  assert.equal(firstProductPage.statusCode, 200, firstProductPage.body);
  assert.equal(json(firstProductPage).products.length, 1);
  assert.equal(json(firstProductPage).pagination.total, 3);
  assert.equal(json(firstProductPage).pagination.hasMore, true);

  const searchedProducts = await app.inject({
    method: "GET",
    url: `/api/stores/${created.id}/products?query=${encodeURIComponent("بطاقة رقمية")}&limit=10`,
    headers: { cookie: ownerCookie }
  });
  assert.equal(searchedProducts.statusCode, 200, searchedProducts.body);
  assert.equal(json(searchedProducts).products.length, 1);
  assert.equal(json(searchedProducts).pagination.total, 1);

  const categoryProducts = await app.inject({
    method: "GET",
    url: `/api/storefront/alpha-store?categoryId=${category.id}&limit=10`
  });
  assert.equal(categoryProducts.statusCode, 200, categoryProducts.body);
  assert.ok(json(categoryProducts).products.some((product) => product.id === localProduct.id));

  const createOrder = await app.inject({
    method: "POST",
    url: "/api/storefront/alpha-store/orders",
    headers: { "idempotency-key": "customer-order-test-1" },
    payload: {
      productId: apiProduct.id,
      customerName: "عميل تجريبي",
      customerEmail: "customer@example.com",
      quantity: 1,
      testPayment: true,
      inputs: { player_id: "PLAYER-123" }
    }
  });
  assert.equal(createOrder.statusCode, 201, createOrder.body);
  assert.equal(json(createOrder).providerExecution, "queued_test_safe");
  const orderId = json(createOrder).order.id;

  const providerExecution = await runProviderOrderOnce(db, config);
  assert.equal(providerExecution.ok, true);
  assert.equal(providerExecution.payload.simulated, true);
  const completedOrder = (await db.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];
  assert.equal(completedOrder.status, "completed");
  const attempts = (
    await db.query(
      `SELECT COUNT(*)::int AS count
       FROM provider_order_attempts a
       JOIN provider_orders p ON p.id = a.provider_order_id
       WHERE p.order_id = $1`,
      [orderId]
    )
  ).rows[0].count;
  assert.equal(attempts, 1);

  const duplicateOrder = await app.inject({
    method: "POST",
    url: "/api/storefront/alpha-store/orders",
    headers: { "idempotency-key": "customer-order-test-1" },
    payload: {
      productId: apiProduct.id,
      customerName: "عميل تجريبي",
      quantity: 1,
      testPayment: true,
      inputs: { player_id: "PLAYER-123" }
    }
  });
  assert.equal(duplicateOrder.statusCode, 200, duplicateOrder.body);
  assert.equal(json(duplicateOrder).duplicate, true);
  assert.equal(json(duplicateOrder).order.id, orderId);

  const storefrontConnection = (
    await db.query("SELECT * FROM bot_connections WHERE store_id = $1 AND purpose = 'storefront'", [
      created.id
    ])
  ).rows[0];
  const webhookSecret = decryptSecret(storefrontConnection.webhook_secret_ciphertext, config.encryptionKey);
  const webhook = await app.inject({
    method: "POST",
    url: `/webhooks/telegram/${storefrontConnection.id}`,
    headers: { "x-telegram-bot-api-secret-token": webhookSecret },
    payload: { update_id: 1, message: { chat: { id: 55 }, text: "/catalog" } }
  });
  assert.equal(webhook.statusCode, 204, webhook.body);

  const secondRegister = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      displayName: "مستخدم متجر آخر",
      email: "other@example.com",
      password: "another-strong-password"
    }
  });
  assert.equal(secondRegister.statusCode, 201);
  const otherCookie = cookieHeader(secondRegister);
  const forbiddenStore = await app.inject({
    method: "GET",
    url: `/api/stores/${created.id}`,
    headers: { cookie: otherCookie }
  });
  assert.equal(forbiddenStore.statusCode, 404);

  const rawSecretSearch = await db.query(
    `SELECT token_ciphertext, webhook_secret_ciphertext, token_masked
     FROM bot_connections WHERE store_id = $1`,
    [created.id]
  );
  assert.ok(rawSecretSearch.rows.every((row) => row.token_ciphertext.startsWith("v1.")));
  assert.ok(rawSecretSearch.rows.every((row) => row.webhook_secret_ciphertext.startsWith("v1.")));
  assert.ok(rawSecretSearch.rows.every((row) => !row.token_ciphertext.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ")));
});

test("production RLS migration and responsive surfaces are present", async () => {
  const rls = await readFile(new URL("../migrations/002_tenant_rls.sql", import.meta.url), "utf8");
  assert.match(rls, /ENABLE ROW LEVEL SECURITY/);
  assert.match(rls, /current_setting\('app\.tenant_id'/);
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.store-mobile-nav/);
  assert.match(css, /\.store-category-grid/);
  assert.match(css, /\.product-media-library/);
  assert.match(css, /data-template=\"gaming-digital\"/);
  assert.match(css, /\.design-editor-layout/);
  const admin = await readFile(new URL("../public/admin.html", import.meta.url), "utf8");
  assert.match(admin, /name="viewport"/);
  assert.match(admin, /توكن بوت المتجر/);
  assert.match(admin, /مكتبة خدمات UCHIHA/);
  assert.match(admin, /id="categoryParent"/);
  assert.match(admin, /id="productMediaLibrary"/);
  assert.match(admin, /id="designForm"/);
  assert.match(admin, /id="adminProductsMore"/);
  const paymentsAdmin = await readFile(new URL("../public/payments-admin.html", import.meta.url), "utf8");
  assert.doesNotMatch(paymentsAdmin, /بصيغة JSON|بأصغر وحدة/);
  assert.match(paymentsAdmin, /name="destinationPrimary"/);
  assert.match(paymentsAdmin, /name="minimumAmount"/);
  const storefront = await readFile(new URL("../public/store.html", import.meta.url), "utf8");
  assert.match(storefront, /id="storeSubcategories"/);
  assert.match(storefront, /class="store-mobile-nav"/);
  assert.match(storefront, /id="storeProductsMore"/);
  assert.match(storefront, /اختر قسمك/);
  assert.doesNotMatch(storefront, /المنتجات لا تملأ الرئيسية/);
  assert.match(storefront, /platform-v3\.css\?v=20260801-platform/);
  assert.match(storefront, /app\.js\?v=20260801-platform/);
  assert.match(storefront, /id="storeBrowseBack"/);
  assert.match(storefront, /data-browse-mode="home"/);
  assert.ok(
    storefront.indexOf('class="store-search-shell"') < storefront.indexOf('class="store-home-intro"'),
    "store search should remain available outside the home-only promotional area"
  );
  assert.ok(
    storefront.indexOf('class="store-main-search"') < storefront.indexOf('class="store-media-banner"'),
    "store search should appear before promotional media"
  );
  const scaleMigration = await readFile(new URL("../migrations/011_catalog_scale_indexes.sql", import.meta.url), "utf8");
  assert.match(scaleMigration, /idx_products_tenant_store_status_sort/);
  const platformMigration = await readFile(new URL("../migrations/015_unified_platform.sql", import.meta.url), "utf8");
  assert.match(platformMigration, /CREATE TABLE IF NOT EXISTS platform_projects/);
  assert.match(platformMigration, /CREATE TABLE IF NOT EXISTS support_threads/);
  const platformCss = await readFile(new URL("../public/platform-v3.css", import.meta.url), "utf8");
  assert.match(platformCss, /\.store-media-banner/);
  assert.match(platformCss, /\.support-workspace/);
  assert.match(platformCss, /\.currency-settings-list/);
  const manifest = await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");
  assert.match(manifest, /app-icon-512\.png/);
  const serviceWorker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /uchiha-shell-v11/);
  const pwa = await readFile(new URL("../public/pwa.js", import.meta.url), "utf8");
  assert.match(pwa, /updateViaCache: "none"/);
  assert.match(pwa, /sw\.js\?v=6/);
  const mobileConfig = await readFile(new URL("../mobile/capacitor.config.json", import.meta.url), "utf8");
  assert.match(mobileConfig, /com\.uchiha\.platform/);
  const workflow = await readFile(new URL("../../.github/workflows/builder-v1.yml", import.meta.url), "utf8");
  assert.match(workflow, /uchiha-owner-android-debug/);
  const staging = await readFile(new URL("../STAGING_CHECKLIST.md", import.meta.url), "utf8");
  assert.match(staging, /Railway Project or Service|Railway Project|Railway Service|Railway/);
  assert.match(staging, /لا نشر على Railway القديمة/);
});
