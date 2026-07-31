import { randomUUID } from "node:crypto";
import { randomToken, safeText, sha256 } from "./security.mjs";
import {
  PaymentError,
  authenticateCustomer,
  authenticatePlatform,
  requireCustomerCsrf,
  requirePlatformCsrf,
  requireStoreAccess,
  storeBySlug,
  writeAudit
} from "./payments.mjs";

const API_ROUTE_APPS = new WeakSet();
const ALLOWED_PERMISSIONS = new Set([
  "categories:read",
  "products:read",
  "products:details",
  "products:availability"
]);
const DEFAULT_PERMISSIONS = [
  "categories:read",
  "products:read",
  "products:details",
  "products:availability"
];

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (error?.code === "23505") {
        throw new PaymentError(409, "conflict", "تعذر إنشاء المفتاح بسبب تعارض، أعد المحاولة");
      }
      throw error;
    }
  };
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "القيمة" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PaymentError(422, "invalid_field", `${field} غير صالح`);
  }
  return parsed;
}

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanPermissions(value) {
  const input = Array.isArray(value) ? value : DEFAULT_PERMISSIONS;
  const permissions = [...new Set(input.map((item) => safeText(item, 80)).filter((item) => ALLOWED_PERMISSIONS.has(item)))];
  if (!permissions.length) throw new PaymentError(422, "invalid_permissions", "اختر صلاحية قراءة واحدة على الأقل");
  return permissions;
}

function cleanIpAllowlist(value) {
  const input = Array.isArray(value) ? value : [];
  if (input.length > 50) throw new PaymentError(422, "ip_allowlist_too_large", "قائمة عناوين IP طويلة جدًا");
  return [...new Set(input.map((item) => safeText(item, 120)).filter(Boolean))];
}

function issueApiToken() {
  return `uch_live_${randomToken(36)}`;
}

function keyDto(row) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    permissions: jsonValue(row.permissions, []),
    ipAllowlist: jsonValue(row.ip_allowlist, []),
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    status: row.status,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    revokedAt: row.revoked_at || null,
    ownerType: row.created_by_customer_id ? "customer" : "store"
  };
}

async function experienceSettings(db, store) {
  await db.query(
    `INSERT INTO store_experience_settings (store_id, tenant_id)
     VALUES ($1,$2) ON CONFLICT (store_id) DO NOTHING`,
    [store.id, store.tenant_id]
  );
  return (await db.query(
    `SELECT * FROM store_experience_settings WHERE store_id=$1 AND tenant_id=$2`,
    [store.id, store.tenant_id]
  )).rows[0];
}

async function storeForCatalogRequest(db, config, request, explicitSlug = "") {
  if (explicitSlug) return storeBySlug(db, explicitSlug);
  const hostname = String(request.hostname || request.headers.host || "").split(":")[0].toLowerCase();
  if (!hostname) throw new PaymentError(404, "store_not_found", "تعذر تحديد المتجر من النطاق");
  const domainStore = (await db.query(
    `SELECT s.*, t.status AS tenant_status
     FROM domains d
     JOIN stores s ON s.id=d.store_id AND s.tenant_id=d.tenant_id
     JOIN tenants t ON t.id=s.tenant_id
     WHERE LOWER(d.hostname)=$1 AND d.status='active'
       AND s.status IN ('active','ready')`,
    [hostname]
  )).rows[0];
  if (domainStore) return domainStore;
  const base = String(config.storeBaseDomain || "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (base && hostname.endsWith(`.${base}`)) {
    const slug = hostname.slice(0, -(base.length + 1)).split(".").at(-1);
    if (slug) return storeBySlug(db, slug);
  }
  throw new PaymentError(404, "store_not_found", "تعذر تحديد المتجر من النطاق");
}

async function authenticateCatalogKey(db, request, store, requiredPermission) {
  const experience = (await db.query(
    `SELECT storefront_api_enabled FROM store_experience_settings
     WHERE tenant_id=$1 AND store_id=$2`,
    [store.tenant_id, store.id]
  )).rows[0];
  if (!experience?.storefront_api_enabled) {
    throw new PaymentError(403, "storefront_api_disabled", "واجهة كتالوج المتجر غير مفعلة");
  }
  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = safeText(bearer || request.headers["x-api-key"], 300);
  if (!token) throw new PaymentError(401, "api_key_required", "أرسل API Token في Authorization: Bearer");
  const key = (await db.query(
    `SELECT * FROM store_api_keys
     WHERE tenant_id=$1 AND store_id=$2 AND token_hash=$3 AND status='active'`,
    [store.tenant_id, store.id, sha256(token)]
  )).rows[0];
  if (!key) throw new PaymentError(401, "invalid_api_key", "API Token غير صالح أو تم إلغاؤه");
  const permissions = new Set(jsonValue(key.permissions, []));
  if (!permissions.has(requiredPermission)) {
    throw new PaymentError(403, "api_permission_denied", "المفتاح لا يملك الصلاحية المطلوبة");
  }
  const allowlist = jsonValue(key.ip_allowlist, []);
  if (Array.isArray(allowlist) && allowlist.length && !allowlist.includes(request.ip)) {
    throw new PaymentError(403, "ip_not_allowed", "عنوان IP الحالي غير موجود في القائمة المسموحة");
  }
  const windowStartedAt = new Date();
  windowStartedAt.setUTCSeconds(0, 0);
  const usage = await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO store_api_rate_windows (key_id, window_started_at, request_count)
       VALUES ($1,$2,1)
       ON CONFLICT (key_id, window_started_at)
       DO UPDATE SET request_count=store_api_rate_windows.request_count+1`,
      [key.id, windowStartedAt]
    );
    return (await client.query(
      `SELECT request_count FROM store_api_rate_windows
       WHERE key_id=$1 AND window_started_at=$2`,
      [key.id, windowStartedAt]
    )).rows[0];
  }, store.tenant_id);
  if (Number(usage?.request_count || 0) > Number(key.rate_limit_per_minute)) {
    throw new PaymentError(429, "api_rate_limit", "تم تجاوز عدد الطلبات المسموح خلال الدقيقة");
  }
  await db.query("UPDATE store_api_keys SET last_used_at=NOW() WHERE id=$1", [key.id]);
  return key;
}

function categoryDto(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url || null,
    sortOrder: Number(row.sort_order),
    updatedAt: row.updated_at
  };
}

function productDto(row, { details = false } = {}) {
  const dto = {
    id: row.id,
    categoryId: row.category_id || null,
    type: row.product_type,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url || null,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    available: row.status === "active" && (row.stock_quantity === null || Number(row.stock_quantity) > 0),
    stockQuantity: row.stock_quantity === null ? null : Number(row.stock_quantity),
    minimumQuantity: Number(row.min_quantity),
    maximumQuantity: row.max_quantity === null ? null : Number(row.max_quantity),
    updatedAt: row.updated_at
  };
  if (details) {
    dto.description = row.description || "";
    dto.options = jsonValue(row.options, []);
    dto.fields = jsonValue(row.fields, []).map((field) => ({
      key: field.key || field.name,
      label: field.label || field.key || field.name,
      type: field.type || "text",
      required: Boolean(field.required),
      options: Array.isArray(field.options) ? field.options : Array.isArray(field.choices) ? field.choices : undefined,
      minimum: field.minimum,
      maximum: field.maximum
    }));
  }
  return dto;
}

export function installStorefrontApiRoutes(app, { db, config }) {
  if (API_ROUTE_APPS.has(app)) return false;
  API_ROUTE_APPS.add(app);

  app.get(
    "/api/public/stores/:slug/developer-key",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      const settings = await experienceSettings(db, store);
      const key = (await db.query(
        `SELECT * FROM store_api_keys
         WHERE tenant_id=$1 AND store_id=$2 AND created_by_customer_id=$3
           AND status='active' ORDER BY created_at DESC LIMIT 1`,
        [store.tenant_id, store.id, customer.id]
      )).rows[0];
      return {
        enabled: Boolean(settings.storefront_api_enabled),
        baseUrl: `https://${store.slug}.${config.storeBaseDomain}/api/v1/`,
        key: key ? keyDto(key) : null,
        permissions: DEFAULT_PERMISSIONS
      };
    })
  );

  app.post(
    "/api/public/stores/:slug/developer-key",
    route(async (request, reply) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      const settings = await experienceSettings(db, store);
      if (!settings.storefront_api_enabled) {
        throw new PaymentError(403, "storefront_api_disabled", "واجهة المطور غير مفعلة في هذا المتجر");
      }
      const token = issueApiToken();
      const id = randomUUID();
      const permissions = cleanPermissions(request.body?.permissions);
      const ipAllowlist = cleanIpAllowlist(request.body?.ipAllowlist);
      const rateLimit = integer(request.body?.rateLimitPerMinute ?? 60, {
        minimum: 1, maximum: 600, field: "حد الطلبات"
      });
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE store_api_keys SET status='revoked', revoked_at=NOW()
           WHERE tenant_id=$1 AND store_id=$2 AND created_by_customer_id=$3 AND status='active'`,
          [store.tenant_id, store.id, customer.id]
        );
        await client.query(
          `INSERT INTO store_api_keys (
             id, tenant_id, store_id, name, token_hash, token_prefix,
             permissions, ip_allowlist, rate_limit_per_minute, created_by_customer_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id, store.tenant_id, store.id, "Customer Catalog API", sha256(token),
            token.slice(0, 18), JSON.stringify(permissions), JSON.stringify(ipAllowlist),
            rateLimit, customer.id
          ]
        );
        await writeAudit(client, {
          store,
          actorCustomerId: customer.id,
          action: "store_api_key.regenerated",
          entityType: "store_api_key",
          entityId: id,
          ipAddress: request.ip,
          afterData: { permissions, ipAllowlist, rateLimit }
        });
      }, store.tenant_id);
      reply.code(201);
      return { key: keyDto({
        id,
        name: "Customer Catalog API",
        token_prefix: token.slice(0, 18),
        permissions,
        ip_allowlist: ipAllowlist,
        rate_limit_per_minute: rateLimit,
        status: "active",
        created_by_customer_id: customer.id,
        created_at: new Date()
      }), token };
    })
  );

  app.delete(
    "/api/public/stores/:slug/developer-key",
    route(async (request) => {
      const store = await storeBySlug(db, request.params.slug);
      const customer = await authenticateCustomer(db, request, store);
      requireCustomerCsrf(request, customer);
      await db.query(
        `UPDATE store_api_keys SET status='revoked', revoked_at=NOW()
         WHERE tenant_id=$1 AND store_id=$2 AND created_by_customer_id=$3 AND status='active'`,
        [store.tenant_id, store.id, customer.id]
      );
      await writeAudit(db, {
        store,
        actorCustomerId: customer.id,
        action: "store_api_key.revoked",
        entityType: "store_api_key",
        entityId: customer.id,
        ipAddress: request.ip
      });
      return { ok: true };
    })
  );

  app.get(
    "/api/stores/:storeId/api-keys",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const rows = await db.query(
        `SELECT * FROM store_api_keys WHERE tenant_id=$1 AND store_id=$2
         ORDER BY created_at DESC LIMIT 200`,
        [store.tenant_id, store.id]
      );
      return { keys: rows.rows.map(keyDto) };
    })
  );

  app.post(
    "/api/stores/:storeId/api-keys",
    route(async (request, reply) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const token = issueApiToken();
      const id = randomUUID();
      const permissions = cleanPermissions(request.body?.permissions);
      const ipAllowlist = cleanIpAllowlist(request.body?.ipAllowlist);
      const rateLimit = integer(request.body?.rateLimitPerMinute ?? 60, {
        minimum: 1, maximum: 10000, field: "حد الطلبات"
      });
      const name = safeText(request.body?.name, 120) || "Storefront Catalog API";
      await db.query(
        `INSERT INTO store_api_keys (
           id, tenant_id, store_id, name, token_hash, token_prefix,
           permissions, ip_allowlist, rate_limit_per_minute, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          id, store.tenant_id, store.id, name, sha256(token), token.slice(0, 18),
          JSON.stringify(permissions), JSON.stringify(ipAllowlist), rateLimit, user.id
        ]
      );
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "store_api_key.created",
        entityType: "store_api_key",
        entityId: id,
        ipAddress: request.ip,
        afterData: { name, permissions, ipAllowlist, rateLimit }
      });
      reply.code(201);
      return { key: keyDto({
        id,
        name,
        token_prefix: token.slice(0, 18),
        permissions,
        ip_allowlist: ipAllowlist,
        rate_limit_per_minute: rateLimit,
        status: "active",
        created_by: user.id,
        created_at: new Date()
      }), token };
    })
  );

  app.delete(
    "/api/stores/:storeId/api-keys/:keyId",
    route(async (request) => {
      const user = await authenticatePlatform(db, request);
      requirePlatformCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const result = await db.query(
        `UPDATE store_api_keys SET status='revoked', revoked_at=NOW()
         WHERE id=$1 AND tenant_id=$2 AND store_id=$3 AND status='active'`,
        [request.params.keyId, store.tenant_id, store.id]
      );
      if (result.rowCount !== 1) throw new PaymentError(404, "api_key_not_found", "المفتاح غير موجود أو ملغى");
      await writeAudit(db, {
        store,
        actorUserId: user.id,
        action: "store_api_key.revoked",
        entityType: "store_api_key",
        entityId: request.params.keyId,
        ipAddress: request.ip
      });
      return { ok: true };
    })
  );

  async function categoriesHandler(request) {
    const store = await storeForCatalogRequest(db, config, request, request.params?.slug || "");
    await authenticateCatalogKey(db, request, store, "categories:read");
    const rows = await db.query(
      `SELECT * FROM categories
       WHERE tenant_id=$1 AND store_id=$2 AND status='active'
       ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, sort_order, name`,
      [store.tenant_id, store.id]
    );
    return { data: rows.rows.map(categoryDto), meta: { store: { name: store.name, slug: store.slug } } };
  }

  async function productsHandler(request) {
    const store = await storeForCatalogRequest(db, config, request, request.params?.slug || "");
    await authenticateCatalogKey(db, request, store, "products:read");
    const limit = integer(request.query?.limit ?? 50, { minimum: 1, maximum: 100, field: "الحد" });
    const offset = integer(request.query?.offset ?? 0, { minimum: 0, maximum: 1_000_000, field: "الإزاحة" });
    const query = safeText(request.query?.query, 120).toLowerCase();
    const categoryId = safeText(request.query?.categoryId, 80);
    const values = [store.tenant_id, store.id];
    const filters = ["p.status='active'"];
    if (query) {
      values.push(`%${query}%`);
      filters.push(`(LOWER(p.name) LIKE $${values.length} OR LOWER(p.description) LIKE $${values.length})`);
    }
    if (categoryId) {
      values.push(categoryId);
      filters.push(`p.category_id=$${values.length}`);
    }
    const where = filters.join(" AND ");
    const total = (await db.query(
      `SELECT COUNT(*) AS total FROM products p
       WHERE p.tenant_id=$1 AND p.store_id=$2 AND ${where}`,
      values
    )).rows[0];
    const rows = await db.query(
      `SELECT p.* FROM products p
       WHERE p.tenant_id=$1 AND p.store_id=$2 AND ${where}
       ORDER BY p.sort_order, p.name LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return {
      data: rows.rows.map((row) => productDto(row)),
      meta: {
        limit,
        offset,
        total: Number(total?.total || 0),
        hasMore: offset + rows.rows.length < Number(total?.total || 0)
      }
    };
  }

  async function productHandler(request) {
    const store = await storeForCatalogRequest(db, config, request, request.params?.slug || "");
    await authenticateCatalogKey(db, request, store, "products:details");
    const row = (await db.query(
      `SELECT * FROM products
       WHERE tenant_id=$1 AND store_id=$2 AND status='active'
         AND (CAST(id AS TEXT)=$3 OR slug=$3)`,
      [store.tenant_id, store.id, request.params.productId]
    )).rows[0];
    if (!row) throw new PaymentError(404, "product_not_found", "المنتج غير موجود");
    return { data: productDto(row, { details: true }) };
  }

  app.get("/api/v1/categories", route(categoriesHandler));
  app.get("/api/v1/products", route(productsHandler));
  app.get("/api/v1/products/:productId", route(productHandler));
  app.get("/api/v1/stores/:slug/categories", route(categoriesHandler));
  app.get("/api/v1/stores/:slug/products", route(productsHandler));
  app.get("/api/v1/stores/:slug/products/:productId", route(productHandler));

  return true;
}
