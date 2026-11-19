import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encryptSecret, sha256 } from "../src/security.mjs";
import { hotp } from "../src/totp.mjs";
import {
  addProduct,
  cookieHeader,
  createOwner,
  createPostgresHarness,
  createStore,
  postgresAvailable,
  proofImage,
  registerCustomer
} from "./postgres-helpers.mjs";

const options = postgresAvailable() ? {} : { skip: "TEST_DATABASE_URL is not configured" };

test("PostgreSQL 4/4: Telegram, TOTP, sessions, private KYC, support and catalog API controls", options, async (context) => {
  const { app, db, config } = await createPostgresHarness(context);
  const owner = await createOwner(app);
  const store = await createStore(db, owner.id, { slug: "postgres-account", name: "Account Store" });
  const customer = await registerCustomer(app, store.slug, "account-buyer@example.com");
  const otherCustomer = await registerCustomer(app, store.slug, "other-buyer@example.com");
  const product = await addProduct(db, store, { name: "API Product", priceMinor: 1200 });
  const categoryId = randomUUID();
  await db.query(
    `INSERT INTO categories (id,tenant_id,store_id,name,slug,sort_order,status)
     VALUES ($1,$2,$3,'API Category','api-category',1,'active')`,
    [categoryId, store.tenantId, store.storeId]
  );
  await db.query("UPDATE products SET category_id=$2 WHERE id=$1", [product.id, categoryId]);

  const setup = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/security/totp/setup`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken },
    payload: { password: "buyer-postgres-password" }
  });
  assert.equal(setup.statusCode, 200, setup.body);
  const secret = setup.json().secret;
  const code = hotp(secret, Math.floor(Date.now() / 30_000));
  const enabled = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/security/totp/enable`,
    headers: { cookie: customer.cookie, "x-customer-csrf-token": customer.csrfToken },
    payload: { password: "buyer-postgres-password", code }
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.equal(enabled.json().recoveryCodes.length, 8);

  const loginChallenge = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/customers/login`,
    payload: { email: customer.email, password: "buyer-postgres-password" }
  });
  assert.equal(loginChallenge.statusCode, 202, loginChallenge.body);
  assert.equal(loginChallenge.json().totpRequired, true);
  const recoveryLogin = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/customers/login/totp`,
    payload: {
      challengeToken: loginChallenge.json().challengeToken,
      code: enabled.json().recoveryCodes[0]
    }
  });
  assert.equal(recoveryLogin.statusCode, 200, recoveryLogin.body);
  const securedCookie = cookieHeader(recoveryLogin);
  const securedCsrf = recoveryLogin.json().csrfToken;
  const security = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/security`,
    headers: { cookie: securedCookie }
  });
  assert.equal(security.statusCode, 200, security.body);
  assert.equal(security.json().level, "strong");
  assert.ok(security.json().sessions.length >= 2);
  const logoutOthers = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/security/sessions/logout-others`,
    headers: { cookie: securedCookie, "x-customer-csrf-token": securedCsrf }
  });
  assert.equal(logoutOthers.statusCode, 200, logoutOthers.body);

  const botSecret = "postgres-telegram-webhook-secret";
  await db.query(
    `INSERT INTO bot_connections (
       id,tenant_id,store_id,purpose,telegram_bot_id,username,token_ciphertext,
       token_fingerprint,token_masked,webhook_secret_ciphertext,webhook_secret_hash,status
     ) VALUES ($1,$2,$3,'storefront',$4,'uchiha_test_bot',$5,$6,'123***xyz',$7,$8,'active')`,
    [
      randomUUID(), store.tenantId, store.storeId, `bot-${randomUUID()}`,
      encryptSecret("fake-bot-token", config.encryptionKey), sha256(`fingerprint-${randomUUID()}`),
      encryptSecret(botSecret, config.encryptionKey), sha256(botSecret)
    ]
  );
  const linkCode = await app.inject({
    method: "POST",
    url: `/api/telegram/stores/${store.storeId}/link-codes`,
    headers: { "x-telegram-webhook-secret": botSecret },
    payload: { telegramUserId: "99887766", telegramUsername: "account_buyer" }
  });
  assert.equal(linkCode.statusCode, 200, linkCode.body);
  const linked = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/telegram-link`,
    headers: { cookie: securedCookie, "x-customer-csrf-token": securedCsrf },
    payload: { code: linkCode.json().code }
  });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().linked, true);
  const reused = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/telegram-link`,
    headers: { cookie: securedCookie, "x-customer-csrf-token": securedCsrf },
    payload: { code: linkCode.json().code }
  });
  assert.equal(reused.statusCode, 422, reused.body);

  const identityDraft = await app.inject({
    method: "PUT",
    url: `/api/public/stores/${store.slug}/identity`,
    headers: { cookie: securedCookie, "x-customer-csrf-token": securedCsrf },
    payload: {
      fullName: "PostgreSQL Test Customer",
      documentType: "passport",
      documentNumber: "SECRET-DOCUMENT-123",
      birthDate: "1998-07-15",
      nationality: "Syrian",
      files: { front: proofImage, back: proofImage, selfie: proofImage }
    }
  });
  assert.equal(identityDraft.statusCode, 200, identityDraft.body);
  const identityId = identityDraft.json().id;
  const submitted = await app.inject({
    method: "POST",
    url: `/api/public/stores/${store.slug}/identity/submit`,
    headers: { cookie: securedCookie, "x-customer-csrf-token": securedCsrf }
  });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.equal(submitted.json().status, "pending_review");

  const ownPrivateFile = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/identity/files/front`,
    headers: { cookie: securedCookie }
  });
  assert.equal(ownPrivateFile.statusCode, 200, ownPrivateFile.body);
  assert.equal(ownPrivateFile.headers["cache-control"], "private, no-store");
  const forbiddenFile = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/identity/files/front`,
    headers: { cookie: otherCustomer.cookie }
  });
  assert.equal(forbiddenFile.statusCode, 404, forbiddenFile.body);
  const adminPrivateFile = await app.inject({
    method: "GET",
    url: `/api/stores/${store.storeId}/identity-requests/${identityId}/files/front`,
    headers: { cookie: owner.cookie }
  });
  assert.equal(adminPrivateFile.statusCode, 200, adminPrivateFile.body);
  const encrypted = (await db.query(
    `SELECT r.document_number_ciphertext,f.content_ciphertext FROM identity_verification_requests r
     JOIN identity_verification_files f ON f.request_id=r.id WHERE r.id=$1 LIMIT 1`,
    [identityId]
  )).rows[0];
  assert.doesNotMatch(encrypted.document_number_ciphertext, /SECRET-DOCUMENT-123/);
  assert.doesNotMatch(encrypted.content_ciphertext, /data:image/);

  const channel = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/support-channels`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: { type: "whatsapp", name: "WhatsApp", description: "دعم خارجي", target: "+905550000000", status: "active" }
  });
  assert.equal(channel.statusCode, 201, channel.body);
  const shell = await app.inject({
    method: "GET",
    url: `/api/public/stores/${store.slug}/account-shell?orderId=ORDER-77&context=${encodeURIComponent("مشكلة في الطلب")}`,
    headers: { cookie: securedCookie }
  });
  assert.equal(shell.statusCode, 200, shell.body);
  assert.equal(shell.json().supportChannels.length, 1);
  assert.match(shell.json().supportChannels[0].url, /^https:\/\/wa\.me\//);
  assert.match(decodeURIComponent(shell.json().supportChannels[0].url), /ORDER-77/);
  assert.doesNotMatch(shell.json().supportChannels[0].url, /password|token/i);

  const apiKey = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/api-keys`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      name: "PostgreSQL catalog key",
      permissions: ["categories:read", "products:read", "products:details"],
      ipAllowlist: ["127.0.0.1"],
      rateLimitPerMinute: 3
    }
  });
  assert.equal(apiKey.statusCode, 201, apiKey.body);
  const token = apiKey.json().token;
  const apiHeaders = { authorization: `Bearer ${token}` };
  const categories = await app.inject({ method: "GET", url: `/api/v1/stores/${store.slug}/categories`, headers: apiHeaders });
  assert.equal(categories.statusCode, 200, categories.body);
  assert.equal(categories.json().data.length, 1);
  const products = await app.inject({ method: "GET", url: `/api/v1/stores/${store.slug}/products`, headers: apiHeaders });
  assert.equal(products.statusCode, 200, products.body);
  assert.equal(products.json().data.length, 1);
  const details = await app.inject({ method: "GET", url: `/api/v1/stores/${store.slug}/products/${product.id}`, headers: apiHeaders });
  assert.equal(details.statusCode, 200, details.body);
  assert.doesNotMatch(details.body, /wallet|payment_method|customer|provider/i);
  const limited = await app.inject({ method: "GET", url: `/api/v1/stores/${store.slug}/products`, headers: apiHeaders });
  assert.equal(limited.statusCode, 429, limited.body);

  const blockedKey = await app.inject({
    method: "POST",
    url: `/api/stores/${store.storeId}/api-keys`,
    headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf },
    payload: {
      name: "Blocked IP key",
      permissions: ["categories:read"],
      ipAllowlist: ["203.0.113.10"],
      rateLimitPerMinute: 10
    }
  });
  assert.equal(blockedKey.statusCode, 201, blockedKey.body);
  const blocked = await app.inject({
    method: "GET",
    url: `/api/v1/stores/${store.slug}/categories`,
    headers: { authorization: `Bearer ${blockedKey.json().token}` }
  });
  assert.equal(blocked.statusCode, 403, blocked.body);
  assert.equal(blocked.json().error, "ip_not_allowed");
});
