import { addDays, nowIso, toJson } from "./utils.js";

export const DEMO = Object.freeze({
  userId: "usr_demo_owner",
  email: "dev-provider@uchiha.test",
  tenantId: "ten_demo_isp",
  membershipId: "mem_demo_owner",
  platformUserId: "usr_demo_platform",
  platformEmail: "dev-platform@uchiha.test"
});

async function insertIgnore(db, sql, params) {
  // Catching a unique violation aborts the entire PostgreSQL transaction.
  await db.run(`${sql} ON CONFLICT DO NOTHING`, params);
}

export async function seedDatabase(db) {
  const now = nowIso();
  const nextMonth = addDays(now, 30);
  await db.transaction(async (tx) => {
    await insertIgnore(tx, `INSERT INTO users
      (id, email, google_sub, display_name, avatar_url, platform_role, created_at, updated_at)
      VALUES (?, ?, NULL, ?, NULL, 'none', ?, ?)`,
    [DEMO.userId, DEMO.email, "مدير شبكة النخبة", now, now]);

    await insertIgnore(tx, `INSERT INTO users
      (id, email, google_sub, display_name, avatar_url, platform_role, created_at, updated_at)
      VALUES (?, ?, NULL, ?, NULL, 'platform_owner', ?, ?)`,
    [DEMO.platformUserId, DEMO.platformEmail, "مالك UCHIHA RADIUS", now, now]);

    await insertIgnore(tx, `INSERT INTO tenants
      (id, name, slug, currency, time_zone, status, created_at, updated_at)
      VALUES (?, ?, ?, 'USD', 'Asia/Damascus', 'active', ?, ?)`,
    [DEMO.tenantId, "شبكة النخبة", "elite-demo", now, now]);

    await insertIgnore(tx, `INSERT INTO memberships
      (id, tenant_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', 'active', ?, ?)`,
    [DEMO.membershipId, DEMO.tenantId, DEMO.userId, now, now]);

    await insertIgnore(tx, `INSERT INTO memberships
      (id, tenant_id, user_id, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 'owner', 'active', ?, ?)`,
    ["mem_demo_platform", DEMO.tenantId, DEMO.platformUserId, now, now]);

    const products = [
      ["prd_starter", "starter", "البداية", 1900, "USD", "monthly", { subscribers: 250, devices: 2, team: 3 }],
      ["prd_growth", "growth", "النمو", 4900, "USD", "monthly", { subscribers: 1500, devices: 10, team: 12 }],
      ["prd_scale", "scale", "المؤسسات", 9900, "USD", "monthly", { subscribers: 10000, devices: 50, team: 50 }]
    ];
    for (const product of products) {
      await insertIgnore(tx, `INSERT INTO subscription_products
        (id, code, name_ar, price_minor, currency, billing_period, limits_json, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?)`, [...product.slice(0, 6), toJson(product[6]), now, now]);
    }

    await insertIgnore(tx, `INSERT INTO tenant_subscriptions
      (id, tenant_id, product_id, status, provider, external_id, starts_at, ends_at, created_at, updated_at)
      VALUES (?, ?, 'prd_growth', 'trialing', 'internal', 'demo-trial', ?, ?, ?, ?)`,
    ["sub_demo_trial", DEMO.tenantId, now, nextMonth, now, now]);

    const plans = [
      ["pln_demo_home", "المنزل 20", 20, 5, 1800],
      ["pln_demo_plus", "السريع 50", 50, 10, 3000],
      ["pln_demo_business", "الأعمال 100", 100, 25, 5500]
    ];
    for (const plan of plans) {
      await insertIgnore(tx, `INSERT INTO plans
        (id, tenant_id, name, speed_down_mbps, speed_up_mbps, price_minor, billing_cycle, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'monthly', 'active', ?, ?)`,
      [plan[0], DEMO.tenantId, ...plan.slice(1), now, now]);
    }

    const subscribers = [
      ["cus_demo_1", "pln_demo_plus", "ahmad-101", "أحمد الخطيب", "+963900000101", "active", 0],
      ["cus_demo_2", "pln_demo_home", "sara-204", "سارة محمود", "+963900000204", "active", 1200],
      ["cus_demo_3", "pln_demo_business", "samir-office", "مكتب سمير", "+963900000330", "suspended", 5500],
      ["cus_demo_4", "pln_demo_home", "nour-440", "نور حسن", "+963900000440", "expired", 1800]
    ];
    for (const subscriber of subscribers) {
      await insertIgnore(tx, `INSERT INTO subscribers
        (id, tenant_id, plan_id, username, full_name, phone, address, status, balance_minor, service_expires_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'دمشق', ?, ?, ?, ?, ?)`,
      [subscriber[0], DEMO.tenantId, ...subscriber.slice(1, 7), nextMonth, now, now]);
    }

    await insertIgnore(tx, `INSERT INTO network_devices
      (id, tenant_id, name, branch, host, api_port, connection_method, username, secret_ciphertext, status, last_seen_at, created_at, updated_at)
      VALUES ('dev_demo_core', ?, 'MikroTik الرئيسي', 'المركز', '192.0.2.10', 8728, 'agent', 'uchiha-agent', NULL, 'online', ?, ?, ?)`,
    [DEMO.tenantId, now, now, now]);

    await insertIgnore(tx, `INSERT INTO radius_sessions
      (id, tenant_id, subscriber_id, device_id, external_session_id, username, framed_ip, nas_ip, started_at, stopped_at, input_bytes, output_bytes, terminate_cause, status, updated_at)
      VALUES ('ses_demo_active', ?, 'cus_demo_1', 'dev_demo_core', 'rad-demo-active', 'ahmad-101', '10.10.0.21', '192.0.2.10', ?, NULL, 94371840, 251658240, NULL, 'active', ?)`,
    [DEMO.tenantId, now, now]);

    await insertIgnore(tx, `INSERT INTO invoices
      (id, tenant_id, subscriber_id, number, amount_minor, paid_minor, currency, status, due_at, created_at, updated_at)
      VALUES ('inv_demo_1', ?, 'cus_demo_2', 'INV-DEMO-001', 3000, 1800, 'USD', 'partial', ?, ?, ?)`,
    [DEMO.tenantId, nextMonth, now, now]);

    await insertIgnore(tx, `INSERT INTO alerts
      (id, tenant_id, severity, category, title, body, status, acknowledged_by_user_id, acknowledged_at, created_at, updated_at)
      VALUES ('alt_demo_1', ?, 'warning', 'billing', 'دفعة جزئية', 'لدى المشترك سارة محمود رصيد متبقٍ.', 'open', NULL, NULL, ?, ?)`,
    [DEMO.tenantId, now, now]);

    await insertIgnore(tx, `INSERT INTO integrations
      (id, tenant_id, type, status, config_json, secret_ciphertext, last_error, last_seen_at, created_at, updated_at)
      VALUES ('int_demo_radius', ?, 'radius', 'active', ?, NULL, NULL, ?, ?, ?)`,
    [DEMO.tenantId, toJson({ mode: "signed-http", version: 1 }), now, now, now]);
  });
}
