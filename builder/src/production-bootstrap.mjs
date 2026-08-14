import {
  ensurePlatformAdmin,
  ensureSubscriptionOffer,
  seedProgrammingServices
} from "./seed.mjs";
import { seedPortalContent } from "./portal-seed.mjs";

function hasOfferSeed(offer = {}) {
  return [
    offer.priceMinor,
    offer.renewalPriceMinor,
    offer.durationUnit,
    offer.durationCount,
    offer.currency
  ].every((value) => value !== null && value !== undefined && value !== "");
}

export async function bootstrapProductionCore(db, config) {
  if (config.nodeEnv !== "production" || config.previewMemoryMode || config.databaseMode !== "postgres") {
    return { skipped: true, reason: "not_production_postgres" };
  }

  // Additive-only portal bootstrap. All seedPortalContent writes use
  // ON CONFLICT ... DO NOTHING, so operator-edited production content is
  // never replaced on restart. Payment methods remain coming_soon until an
  // administrator supplies real destination details and activates them.
  await seedPortalContent(db, { ...config, demoSeed: false });

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
    platformServiceCount: serviceCount
  };
}
