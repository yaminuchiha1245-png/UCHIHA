import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { createDatabase } from "../src/db.mjs";
import { installLaunchRenewalRoutes } from "../src/launch-renewals.mjs";
import { installLaunchSubscriptionAdminRoutes } from "../src/launch-subscription-admin.mjs";
import { installLaunchSubscriptionRoutes } from "../src/launch-subscriptions.mjs";

test("launch sales routes register on the base application without duplicate Fastify routes", async (context) => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_MODE: "memory",
    RATE_LIMIT_ENABLED: "false",
    APP_BASE_URL: "http://builder.test",
    STORE_BASE_DOMAIN: "builder.test",
    TELEGRAM_MODE: "fake",
    UCHIHA_API_1_MODE: "test"
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
  await assert.doesNotReject(app.ready());

  const publicOffer = await app.inject({ method: "GET", url: "/api/subscription-offer" });
  assert.equal(publicOffer.statusCode, 200, publicOffer.body);

  const adminOffer = await app.inject({ method: "GET", url: "/api/platform/subscription-offer" });
  assert.equal(adminOffer.statusCode, 401, adminOffer.body);
  const renewals = await app.inject({ method: "GET", url: "/api/subscription-renewals" });
  assert.equal(renewals.statusCode, 401, renewals.body);
});
