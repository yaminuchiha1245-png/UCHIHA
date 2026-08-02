import { ensureShowcaseStore } from "./seed.mjs";

const DEMO_PORTFOLIO_ID = "50000000-0000-4000-8000-000000000001";
const DEMO_DOMAIN_ID = "00000000-0000-4000-8000-000000000103";

function validBaseDomain(value) {
  const domain = String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!domain || domain === "localhost" || domain.endsWith(".localhost")) return "";
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return "";
  return domain;
}

export async function ensureProductionShowcase(db, config = {}) {
  const showcase = await ensureShowcaseStore(db, config);

  await db.query(
    `UPDATE payment_methods
     SET status='disabled',
         instructions='طريقة تجريبية للعرض فقط — لا ترسل أي أموال أو إثباتات.',
         updated_at=NOW()
     WHERE tenant_id=$1 AND store_id=$2`,
    [showcase.tenantId, showcase.storeId]
  );

  await db.query(
    `UPDATE stores
     SET contact_data=$2, updated_at=NOW()
     WHERE id=$1`,
    [
      showcase.storeId,
      JSON.stringify({
        demoMode: true,
        readOnly: true,
        paymentsDisabled: true,
        ordersDisabled: true,
        notice: "متجر عرض فقط — لا توجد عمليات مالية أو طلبات حقيقية."
      })
    ]
  );

  await db.query(
    `INSERT INTO portfolio_items (
       id, title_ar, title_en, description_ar, description_en,
       image_url, target_url, item_type, status, sort_order
     ) VALUES (
       $1,
       'متجر رقمي تجريبي حقيقي',
       'Working Digital Store Demo',
       'متجر عرض دائم داخل PostgreSQL مع أقسام ومنتجات وخيارات، وجميع العمليات المالية معطلة.',
       'A persistent PostgreSQL demo with categories, products, and options. All real payments and orders are disabled.',
       '/assets/marketing-assets/showcase-store.svg',
       '/store/demo','demo','active',10
     )
     ON CONFLICT (id) DO UPDATE SET
       title_ar=EXCLUDED.title_ar,
       title_en=EXCLUDED.title_en,
       description_ar=EXCLUDED.description_ar,
       description_en=EXCLUDED.description_en,
       image_url=EXCLUDED.image_url,
       target_url=EXCLUDED.target_url,
       item_type='demo', status='active', sort_order=10, updated_at=NOW()`,
    [DEMO_PORTFOLIO_ID]
  );

  const baseDomain = validBaseDomain(config.storeBaseDomain);
  const hostname = baseDomain ? `demo.${baseDomain}` : null;
  if (hostname) {
    await db.query(
      `INSERT INTO domains (
         id, tenant_id, store_id, hostname, domain_type, status,
         is_primary, dns_checked_at, ssl_status
       ) VALUES ($1,$2,$3,$4,'subdomain','active',TRUE,NOW(),'active')
       ON CONFLICT (hostname) DO UPDATE SET
         tenant_id=EXCLUDED.tenant_id,
         store_id=EXCLUDED.store_id,
         domain_type='subdomain', status='active', is_primary=TRUE,
         dns_checked_at=NOW(), ssl_status='active'`,
      [DEMO_DOMAIN_ID, showcase.tenantId, showcase.storeId, hostname]
    );
  }

  return { ...showcase, hostname, readOnly: true };
}

export const DEMO_STORE_ID = "00000000-0000-4000-8000-000000000102";
