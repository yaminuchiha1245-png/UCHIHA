import { createRuntime } from "./runtime.mjs";
import { ensureProductionShowcase } from "./showcase.mjs";

const { config, db } = await createRuntime({ seed: false });
try {
  const showcase = await ensureProductionShowcase(db, config);
  console.log(JSON.stringify({
    ok: true,
    slug: showcase.slug,
    path: `/store/${showcase.slug}`,
    hostname: showcase.hostname,
    readOnly: showcase.readOnly
  }, null, 2));
} finally {
  await db.close();
}
