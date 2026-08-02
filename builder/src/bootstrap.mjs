import { createRuntime } from "./runtime.mjs";
import { seedEnvironment } from "./seed.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db } = await createRuntime();
try {
  const result = await seedEnvironment(db, config);
  const showcase = await ensureProductionShowcase(db, config);
  console.log(
    JSON.stringify(
      {
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
