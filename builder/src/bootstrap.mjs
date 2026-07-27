import { createRuntime } from "./runtime.mjs";
import { seedEnvironment } from "./seed.mjs";

const { config, db } = await createRuntime();
try {
  const result = await seedEnvironment(db, config);
  console.log(
    JSON.stringify(
      {
        offer: result.offer.name,
        providerAlias: result.provider.public_alias,
        syncedServices: result.sync.services,
        platformAdminCreated: Boolean(result.admin)
      },
      null,
      2
    )
  );
} finally {
  await db.close();
}

