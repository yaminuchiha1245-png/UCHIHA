import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { installHttpHardening } from "../src/http-hardening.mjs";
import { installLaunchAssetInjection } from "../src/launch-assets.mjs";
import { installLaunchReadinessHttp } from "../src/launch-readiness-http.mjs";
import { installLaunchRenewalRoutes } from "../src/launch-renewals.mjs";
import { installLaunchSubscriptionAdminRoutes } from "../src/launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "../src/launch-subscriptions.mjs";
import { installSupportChatDownloadHardening } from "../src/support-chat-download-hardening.mjs";
import { installSupportChatV2 } from "../src/support-chat-v2.mjs";
import { installV41ProductionCsp } from "../src/v41-production-csp.mjs";

test("production launch modules register on the base application without duplicate Fastify routes", async (context) => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    RATE_LIMIT_ENABLED: "false",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "builder.test",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64")
  });
  const db = await createDatabase(config);
  const app = await buildApp({ db, config, logger: false, startWorkers: false });
  context.after(async () => {
    await app.close();
    await db.close();
  });

  assert.doesNotThrow(() => installLaunchSubscriptionRoutes(app, { db, config }));
  assert.doesNotThrow(() => installLaunchSubscriptionAdminRoutes(app, { db, config }));
  assert.doesNotThrow(() => installLaunchRenewalRoutes(app, { db, config }));
  assert.doesNotThrow(() => installLaunchReadinessHttp(app, { db, config }));
  assert.doesNotThrow(() => installSupportChatDownloadHardening(app));
  assert.doesNotThrow(() => installSupportChatV2(app, { db, config }));
  assert.doesNotThrow(() => installLaunchAssetInjection(app));
  assert.doesNotThrow(() => installV41ProductionCsp(app));
  assert.doesNotThrow(() => installHttpHardening(app, config));
  await assert.doesNotReject(app.ready());

  const publicOffer = await app.inject({ method: "GET", url: "/api/subscription-offer" });
  assert.equal(publicOffer.statusCode, 200, publicOffer.body);

  const adminOffer = await app.inject({ method: "GET", url: "/api/platform/subscription-offer" });
  assert.equal(adminOffer.statusCode, 401, adminOffer.body);
  const adminPatch = await app.inject({ method: "PATCH", url: "/api/platform/subscription-offer", payload: {} });
  assert.equal(adminPatch.statusCode, 401, adminPatch.body);

  const renewals = await app.inject({ method: "GET", url: "/api/subscription-renewals" });
  assert.equal(renewals.statusCode, 401, renewals.body);
  const support = await app.inject({ method: "GET", url: "/api/public/stores/demo/support-v2" });
  assert.equal(support.statusCode, 401, support.body);
});
