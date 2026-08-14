import {
  ensurePlatformAdmin,
  ensureSubscriptionOffer,
  seedProgrammingServices
} from "./seed.mjs";
import { PLATFORM_SERVICE_SEED } from "./portal-seed.mjs";

function hasOfferSeed(offer = {}) {
  return [
    offer.priceMinor,
    offer.renewalPriceMinor,
    offer.durationUnit,
    offer.durationCount,
    offer.currency
  ].every((value) => value !== null && value !== undefined && value !== "");
}

async function ensureProductionPlatformServices(db) {
  let created = 0;
  for (const [index, service] of PLATFORM_SERVICE_SEED.entries()) {
    const existing = await db.query(
      "SELECT id FROM platform_services WHERE service_key=$1 OR slug=$2 LIMIT 1",
      [service.key, service.slug]
    );
    if (existing.rows[0]) continue;
    const result = await db.query(
      `INSERT INTO platform_services (
         id, service_key, slug, icon_key, name_ar, name_en,
         description_ar, description_en, features_ar, features_en,
         estimated_duration_ar, estimated_duration_en, status, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',$13)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        service.id,
        service.key,
        service.slug,
        service.icon,
        service.ar,
        service.en,
        service.descriptionAr,
        service.descriptionEn,
        JSON.stringify(service.featuresAr),
        JSON.stringify(service.featuresEn),
        service.durationAr,
        service.durationEn,
        (index + 1) * 10
      ]
    );
    if (result.rows[0]) created += 1;
  }
  return created;
}

export async function bootstrapProductionCore(db, config) {
  if (config.nodeEnv !== "production" || config.previewMemoryMode || config.databaseMode !== "postgres") {
    return { skipped: true, reason: "not_production_postgres" };
  }

  // Production bootstrap is deliberately narrower than demo/portal seeding.
  // It never creates or edits payment destinations, provider credentials,
  // showcase data, banners or operator-managed settings.
  const platformServicesCreated = await ensureProductionPlatformServices(db);

  const existingOffer = (
    await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1")
  ).rows[0] || null;
  let offer = existingOffer;
  let offerCreated = false;
  if (!offer && hasOfferSeed(config.offerSeed)) {
    offer = await ensureSubscriptionOffer(db, config.offerSeed);
    offerCreated = Boolean(offer);
  }

  const activeAdminCount = Number((
    await db.query(
      "SELECT count(*)::int AS count FROM platform_users WHERE is_platform_admin=TRUE AND status='active'"
    )
  ).rows[0]?.count || 0);
  let adminCreatedOrPromoted = false;
  if (activeAdminCount === 0 && config.platformAdminEmail && config.platformAdminPassword) {
    const admin = await ensurePlatformAdmin(db, config.platformAdminEmail, config.platformAdminPassword);
    adminCreatedOrPromoted = Boolean(admin);
  }

  // Programming services are create-only by name. Use the configured/live
  // offer currency when available without touching merchant-edited rows.
  await seedProgrammingServices(db, offer?.currency || config.offerSeed?.currency || "USD");

  const finalAdminCount = Number((
    await db.query(
      "SELECT count(*)::int AS count FROM platform_users WHERE is_platform_admin=TRUE AND status='active'"
    )
  ).rows[0]?.count || 0);
  const finalOffer = (
    await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1")
  ).rows[0] || null;
  const serviceCount = Number((
    await db.query(
      "SELECT count(*)::int AS count FROM platform_services WHERE tenant_id IS NULL AND store_id IS NULL AND status='active'"
    )
  ).rows[0]?.count || 0);

  return {
    skipped: false,
    offerPresent: Boolean(finalOffer),
    offerCreated,
    activeAdminPresent: finalAdminCount > 0,
    adminCreatedOrPromoted,
    platformServiceCount: serviceCount,
    platformServicesCreated
  };
}
