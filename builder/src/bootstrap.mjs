import { createRuntime } from "./runtime.mjs";
import { seedEnvironment } from "./seed.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db, productionBootstrap } = await createRuntime();
try {
  const persistentProduction = config.nodeEnv === "production"
    && config.databaseMode === "postgres"
    && !config.previewMemoryMode;

  // Production runtime already executes bootstrapProductionCore inside createRuntime().
  // Never run the demo/development seed here: it can invent provider credentials,
  // require owner pricing before deployment, or synchronize a test provider.
  const result = persistentProduction ? null : await seedEnvironment(db, config);
  const showcase = await ensureProductionShowcase(db, config);

  console.log(
    JSON.stringify(
      persistentProduction
        ? {
            production: true,
            productionBootstrap,
            demoStore: {
              slug: showcase.slug,
              path: `/store/${showcase.slug}`,
              hostname: showcase.hostname,
              readOnly: showcase.readOnly
            }
          }
        : {
            production: false,
            offer: result.offer.name,
            providerAlias: result.provider.public_alias,
            syncedServices: result.sync.services,
            platformAdminCreated: Boolean(result.admin),
            demoStore: {
              slug: showcase.slug,
              path: `/store/${showcase.slug}`,
              hostname: showcase.hostname,
              readOnly: showcase.readOnly
            }
          },
      null,
      2
    )
  );
} finally {
  await db.close();
}
