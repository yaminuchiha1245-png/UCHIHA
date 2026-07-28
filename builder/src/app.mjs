import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
  isHexColor,
  maskSecret,
  normalizeEmail,
  normalizeSlug,
  randomToken,
  safeText,
  sha256,
  verifyPassword
} from "./security.mjs";
import { publicProvider, syncProvider } from "./providers.mjs";
import { TelegramGateway, handleTelegramUpdate } from "./telegram.mjs";
import { startWorkerLoop } from "./worker.mjs";
import { installPaymentRoutes } from "./payments.mjs";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const SESSION_COOKIE = "uchiha_builder_session";
const RESERVED_SLUGS = new Set(["www", "admin", "api", "app", "support", "help", "builder", "uchiha"]);
const PRODUCT_TYPES = new Set([
  "digital",
  "physical",
  "service",
  "subscription",
  "code",
  "account",
  "game_topup",
  "api_service",
  "programming_service"
]);
const DELIVERY_MODES = new Set(["manual", "automatic", "provider_api"]);
const STORE_TEMPLATES = new Set([
  "digital",
  "tech-services",
  "gaming",
  "commerce-light",
  "modern-dark",
  "luxury",
  "general"
]);
const PRODUCT_MEDIA = Object.freeze({
  "digital-card": "/assets/catalog-assets/digital-card.svg",
  "game-topup": "/assets/catalog-assets/game-topup.svg",
  "mobile-credit": "/assets/catalog-assets/mobile-credit.svg",
  subscription: "/assets/catalog-assets/subscription.svg",
  software: "/assets/catalog-assets/software.svg",
  "social-service": "/assets/catalog-assets/social-service.svg",
  programming: "/assets/catalog-assets/programming.svg"
});

class ApiError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function jsonArray(value) {
  const parsed = jsonValue(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, field = "value" } = {}) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(422, "invalid_field", `قيمة ${field} غير صالحة`);
  }
  return parsed;
}

function requiredText(value, field, maxLength = 200) {
  const text = safeText(value, maxLength);
  if (!text) throw new ApiError(422, "missing_field", `الحقل ${field} مطلوب`);
  return text;
}

function optionalText(value, maxLength = 1000) {
  return safeText(value, maxLength);
}

function durationEnd(start, unit, count) {
  const end = new Date(start);
  if (unit === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
  else if (unit === "month") end.setUTCMonth(end.getUTCMonth() + count);
  else end.setUTCDate(end.getUTCDate() + count);
  return end;
}

function storeLinks(config, store) {
  return {
    storefront: `${config.appBaseUrl}/store/${store.slug}`,
    dashboard: `${config.appBaseUrl}/admin/${store.id}`,
    subdomain: `https://${store.slug}.${config.storeBaseDomain}`
  };
}

function offerDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    priceMinor: Number(row.price_minor),
    renewalPriceMinor: Number(row.renewal_price_minor),
    currency: row.currency,
    durationUnit: row.duration_unit,
    durationCount: Number(row.duration_count),
    trialDays: Number(row.trial_days),
    discountPercent: Number(row.discount_percent),
    saleEnabled: row.sale_enabled,
    renewalEnabled: row.renewal_enabled
  };
}

function designDto(row) {
  if (!row) return null;
  return {
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    backgroundColor: row.background_color,
    surfaceColor: row.surface_color,
    textColor: row.text_color,
    mutedTextColor: row.muted_text_color,
    borderColor: row.border_color,
    successColor: row.success_color,
    warningColor: row.warning_color,
    dangerColor: row.danger_color,
    fontFamily: row.font_family,
    borderRadius: row.border_radius,
    buttonStyle: row.button_style,
    cardStyle: row.card_style,
    logoUrl: row.logo_url,
    faviconUrl: row.favicon_url,
    coverUrl: row.cover_url
  };
}

function storeDto(config, row, design = null) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    slug: row.slug,
    activityType: row.activity_type,
    description: row.description,
    country: row.country,
    language: row.language,
    currency: row.currency,
    templateKey: row.template_key,
    status: row.status,
    contacts: jsonValue(row.contact_data, {}),
    welcomeMessage: row.welcome_message,
    design: designDto(design),
    links: storeLinks(config, row)
  };
}

function categoryDto(row) {
  return {
    id: row.id,
    parentId: row.parent_id || null,
    name: row.name,
    slug: row.slug,
    imageUrl: row.image_url || null,
    sortOrder: Number(row.sort_order || 0),
    status: row.status
  };
}

function productDto(row) {
  const metadata = jsonValue(row.metadata, {});
  const media = jsonValue(metadata.media, {});
  return {
    id: row.id,
    categoryId: row.category_id,
    type: row.product_type,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.image_url,
    priceMinor: Number(row.price_minor),
    currency: row.currency,
    stockQuantity: row.stock_quantity === null ? null : Number(row.stock_quantity),
    minimumQuantity: Number(row.min_quantity),
    maximumQuantity: row.max_quantity === null ? null : Number(row.max_quantity),
    deliveryMode: row.delivery_mode,
    sourceKind: row.source_kind,
    fields: jsonArray(row.fields),
    options: jsonArray(row.options),
    media: {
      source: media.source || (row.image_url ? "legacy" : "platform"),
      key: media.key || null,
      locked: Boolean(media.locked)
    },
    status: row.status
  };
}

function inferProductMediaKey(productType, name = "") {
  const searchable = String(name).toLowerCase();
  if (productType === "programming_service" || /برمج|موقع|تطبيق|تطوير|واجهة|api/.test(searchable)) {
    return "programming";
  }
  if (productType === "game_topup" || /لعب|game|ببجي|pubg|فري فاير|free fire/.test(searchable)) {
    return "game-topup";
  }
  if (/رصيد|اتصال|هاتف|موبايل|mobile|telecom/.test(searchable)) {
    return "mobile-credit";
  }
  if (productType === "subscription" || /اشتراك|مشاهدة|netflix|stream/.test(searchable)) {
    return "subscription";
  }
  if (/تواصل|اجتماع|متابع|مشاهد|social|telegram|instagram|youtube/.test(searchable)) {
    return "social-service";
  }
  if (/برنامج|تصميم|software|windows|android|ios|أداة/.test(searchable)) {
    return "software";
  }
  return "digital-card";
}

function resolveProductMedia(input, productType, name) {
  const customImage = optionalText(input?.imageUrl, 1000);
  if (customImage) {
    return {
      imageUrl: customImage,
      metadata: { media: { source: "merchant", key: null, locked: true } }
    };
  }
  const key = optionalText(input?.mediaKey, 80) || inferProductMediaKey(productType, name);
  if (!Object.hasOwn(PRODUCT_MEDIA, key)) {
    throw new ApiError(422, "invalid_media_key", "صورة مكتبة المنتجات غير صالحة");
  }
  return {
    imageUrl: PRODUCT_MEDIA[key],
    metadata: { media: { source: "platform", key, locked: false } }
  };
}

async function issueSession(db, config, request, userId) {
  const token = randomToken();
  const csrf = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionHours * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO sessions (
       token_hash, user_id, csrf_hash, expires_at, user_agent, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      sha256(token),
      userId,
      sha256(csrf),
      expiresAt,
      optionalText(request.headers["user-agent"], 500),
      request.ip
    ]
  );
  return { token, csrf, expiresAt };
}

function setSessionCookie(reply, config, token, expiresAt) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    expires: expiresAt
  });
}

async function authenticate(db, request) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) throw new ApiError(401, "authentication_required", "يجب تسجيل الدخول");
  const result = await db.query(
    `SELECT u.*, s.csrf_hash, s.expires_at
     FROM sessions s
     JOIN platform_users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.status = 'active'`,
    [sha256(token)]
  );
  const user = result.rows[0];
  if (!user) throw new ApiError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return user;
}

function requireCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new ApiError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

async function requireStoreAccess(db, user, storeId) {
  const result = await db.query(
    `SELECT s.*, t.status AS tenant_status, tm.role_key
     FROM stores s
     JOIN tenants t ON t.id = s.tenant_id
     JOIN tenant_memberships tm ON tm.tenant_id = s.tenant_id
     WHERE s.id = $1 AND tm.user_id = $2 AND tm.status = 'active'`,
    [storeId, user.id]
  );
  const store = result.rows[0];
  if (!store) throw new ApiError(404, "store_not_found", "المتجر غير موجود");
  return store;
}

function requirePlatformAdmin(user) {
  if (!user.is_platform_admin) {
    throw new ApiError(403, "platform_permission_required", "هذه العملية خاصة بإدارة منصة UCHIHA");
  }
}

async function uniqueProductSlug(db, tenantId, baseName) {
  const base = normalizeSlug(baseName) || `item-${randomUUID().slice(0, 8)}`;
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const found = await db.query("SELECT 1 FROM products WHERE tenant_id = $1 AND slug = $2", [
      tenantId,
      candidate
    ]);
    if (!found.rows[0]) return candidate;
    candidate = `${base}-${attempt + 2}`;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

function pricing(service, provider, input) {
  const settings = jsonValue(provider.sync_settings, {});
  const platformPercent = Number(settings.platformMarginPercent || 0);
  const platformFixed = Number(settings.platformMarginFixedMinor || 0);
  const originalCost = Number(service.original_cost_minor);
  const platformProfit = Math.max(0, Math.round(originalCost * (platformPercent / 100)) + platformFixed);
  const uchihaCost = originalCost + platformProfit;
  const mode = input.profitMode || "percent";
  const value = Number(input.profitValue || 0);
  let sellingPrice;
  if (mode === "manual") {
    sellingPrice = integer(input.sellingPriceMinor, {
      minimum: uchihaCost,
      field: "سعر البيع"
    });
  } else if (mode === "fixed") {
    sellingPrice = uchihaCost + Math.max(0, Math.round(value));
  } else if (mode === "percent") {
    sellingPrice = uchihaCost + Math.max(0, Math.round(uchihaCost * (value / 100)));
  } else {
    throw new ApiError(422, "invalid_pricing", "طريقة التسعير غير مدعومة");
  }
  return {
    mode,
    value,
    originalCost,
    platformProfit,
    uchihaCost,
    sellingPrice,
    merchantProfit: sellingPrice - uchihaCost
  };
}

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.code === "23505") {
        throw new ApiError(409, "conflict", "القيمة مستخدمة مسبقًا");
      }
      throw error;
    }
  };
}

export async function buildApp({ db, config, logger = false, startWorkers = false }) {
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024
  });
  await app.register(cookie);
  await app.register(fastifyStatic, {
    root: publicDirectory,
    prefix: "/assets/",
    decorateReply: true
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) request.log.error({ error }, "Unhandled request error");
    reply.code(statusCode).send({
      error: error.code || (statusCode === 500 ? "internal_error" : "request_error"),
      message:
        statusCode === 500 && config.nodeEnv === "production"
          ? "حدث خطأ داخلي. تم تسجيل المشكلة."
          : error.message,
      details: error.details
    });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
    );
    return payload;
  });

  installPaymentRoutes(app, { db, config });

  app.get("/", async (_request, reply) => reply.sendFile("index.html"));
  app.get("/store/:slug", async (_request, reply) => reply.sendFile("store.html"));
  app.get("/admin/:storeId", async (_request, reply) => reply.sendFile("admin.html"));

  app.get("/health", async () => ({
    status: "ok",
    service: "uchiha-builder",
    database: config.databaseMode === "postgres" ? "postgresql" : "memory-demo",
    timestamp: new Date().toISOString()
  }));

  app.get("/api/public/config", async () => ({
    demoMode: config.allowDemoBilling,
    storeBaseDomain: config.storeBaseDomain,
    templates: [...STORE_TEMPLATES]
  }));

  app.post(
    "/api/auth/register",
    route(async (request, reply) => {
      const body = request.body || {};
      const email = normalizeEmail(body.email);
      const displayName = requiredText(body.displayName, "الاسم", 120);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ApiError(422, "invalid_email", "البريد الإلكتروني غير صالح");
      }
      const passwordHash = await hashPassword(String(body.password || ""));
      const id = randomUUID();
      try {
        await db.query(
          `INSERT INTO platform_users (id, email, display_name, password_hash)
           VALUES ($1, $2, $3, $4)`,
          [id, email, displayName, passwordHash]
        );
      } catch (error) {
        if (error.code === "23505") {
          throw new ApiError(409, "email_exists", "يوجد حساب بهذا البريد");
        }
        throw error;
      }
      const session = await issueSession(db, config, request, id);
      setSessionCookie(reply, config, session.token, session.expiresAt);
      reply.code(201);
      return { user: { id, email, displayName, isPlatformAdmin: false }, csrfToken: session.csrf };
    })
  );

  app.post(
    "/api/auth/login",
    route(async (request, reply) => {
      const body = request.body || {};
      const email = normalizeEmail(body.email);
      const result = await db.query("SELECT * FROM platform_users WHERE email = $1", [email]);
      const user = result.rows[0];
      if (!user || !(await verifyPassword(String(body.password || ""), user.password_hash))) {
        throw new ApiError(401, "invalid_credentials", "بيانات الدخول غير صحيحة");
      }
      const session = await issueSession(db, config, request, user.id);
      setSessionCookie(reply, config, session.token, session.expiresAt);
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          isPlatformAdmin: user.is_platform_admin
        },
        csrfToken: session.csrf
      };
    })
  );

  app.post(
    "/api/auth/logout",
    route(async (request, reply) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const token = request.cookies[SESSION_COOKIE];
      await db.query("UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1", [sha256(token)]);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    })
  );

  app.get(
    "/api/me",
    route(async (request) => {
      const user = await authenticate(db, request);
      const csrfToken = randomToken(24);
      await db.query(
        "UPDATE sessions SET csrf_hash = $2 WHERE token_hash = $1",
        [sha256(request.cookies[SESSION_COOKIE]), sha256(csrfToken)]
      );
      const memberships = await db.query(
        `SELECT s.id, s.name, s.slug, s.status, s.tenant_id, tm.role_key
         FROM tenant_memberships tm
         JOIN stores s ON s.tenant_id = tm.tenant_id
         WHERE tm.user_id = $1 AND tm.status = 'active'
         ORDER BY s.created_at`,
        [user.id]
      );
      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          isPlatformAdmin: user.is_platform_admin
        },
        stores: memberships.rows.map((row) => ({
          ...storeDto(config, row),
          role: row.role_key
        })),
        csrfToken
      };
    })
  );

  app.get("/api/subscription-offer", async () => {
    const result = await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1");
    return { offer: offerDto(result.rows[0]) };
  });

  app.put(
    "/api/platform/subscription-offer",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      requirePlatformAdmin(user);
      const body = request.body || {};
      const existing = await db.query("SELECT * FROM subscription_offers ORDER BY created_at LIMIT 1");
      const id = existing.rows[0]?.id || randomUUID();
      const values = {
        name: requiredText(body.name, "اسم الاشتراك", 120),
        priceMinor: integer(body.priceMinor, { minimum: 0, field: "السعر" }),
        renewalPriceMinor: integer(body.renewalPriceMinor, { minimum: 0, field: "سعر التجديد" }),
        currency: requiredText(body.currency, "العملة", 3).toUpperCase(),
        durationUnit: body.durationUnit,
        durationCount: integer(body.durationCount, { minimum: 1, maximum: 120, field: "المدة" }),
        trialDays: integer(body.trialDays ?? 0, { minimum: 0, maximum: 365, field: "التجربة" }),
        discountPercent: integer(body.discountPercent ?? 0, {
          minimum: 0,
          maximum: 100,
          field: "الخصم"
        }),
        saleEnabled: Boolean(body.saleEnabled),
        renewalEnabled: Boolean(body.renewalEnabled)
      };
      if (!["day", "month", "year"].includes(values.durationUnit)) {
        throw new ApiError(422, "invalid_duration", "وحدة مدة الاشتراك غير صالحة");
      }
      if (existing.rows[0]) {
        await db.query(
          `UPDATE subscription_offers
           SET name = $2, price_minor = $3, renewal_price_minor = $4, currency = $5,
               duration_unit = $6, duration_count = $7, trial_days = $8,
               discount_percent = $9, sale_enabled = $10, renewal_enabled = $11,
               updated_at = NOW()
           WHERE id = $1`,
          [
            id,
            values.name,
            values.priceMinor,
            values.renewalPriceMinor,
            values.currency,
            values.durationUnit,
            values.durationCount,
            values.trialDays,
            values.discountPercent,
            values.saleEnabled,
            values.renewalEnabled
          ]
        );
      } else {
        await db.query(
          `INSERT INTO subscription_offers (
             id, name, price_minor, renewal_price_minor, currency, duration_unit,
             duration_count, trial_days, discount_percent, sale_enabled, renewal_enabled
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            values.name,
            values.priceMinor,
            values.renewalPriceMinor,
            values.currency,
            values.durationUnit,
            values.durationCount,
            values.trialDays,
            values.discountPercent,
            values.saleEnabled,
            values.renewalEnabled
          ]
        );
      }
      const updated = await db.query("SELECT * FROM subscription_offers WHERE id = $1", [id]);
      return { offer: offerDto(updated.rows[0]) };
    })
  );

  app.post(
    "/api/subscriptions/demo-activate",
    route(async (request) => {
      if (!config.allowDemoBilling) {
        throw new ApiError(404, "not_found", "التفعيل التجريبي غير متاح");
      }
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const body = request.body || {};
      const offer = (await db.query("SELECT * FROM subscription_offers WHERE id = $1", [body.offerId])).rows[0];
      if (!offer || !offer.sale_enabled) {
        throw new ApiError(404, "offer_unavailable", "الاشتراك غير متاح");
      }
      const existing = await db.query(
        `SELECT * FROM subscriptions
         WHERE user_id = $1 AND tenant_id IS NULL AND status IN ('trial', 'active')
         ORDER BY created_at LIMIT 1`,
        [user.id]
      );
      if (existing.rows[0]) return { subscription: existing.rows[0] };
      const startsAt = new Date();
      const endsAt = durationEnd(startsAt, offer.duration_unit, Number(offer.duration_count));
      const id = randomUUID();
      await db.query(
        `INSERT INTO subscriptions (
           id, user_id, offer_id, status, activation_mode, starts_at, ends_at, renews_at
         ) VALUES ($1, $2, $3, 'active', 'demo', $4, $5, $5)`,
        [id, user.id, offer.id, startsAt, endsAt]
      );
      return {
        subscription: {
          id,
          offerId: offer.id,
          status: "active",
          activationMode: "demo",
          startsAt,
          endsAt
        }
      };
    })
  );

  app.get(
    "/api/stores/slug/:slug/availability",
    route(async (request) => {
      await authenticate(db, request);
      const slug = normalizeSlug(request.params.slug);
      if (slug.length < 3 || RESERVED_SLUGS.has(slug)) {
        return { slug, available: false, reason: "reserved_or_invalid" };
      }
      const exists = await db.query("SELECT 1 FROM stores WHERE slug = $1", [slug]);
      return { slug, available: !exists.rows[0] };
    })
  );

  app.post(
    "/api/stores",
    route(async (request, reply) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const idempotencyKey = requiredText(request.headers["idempotency-key"], "Idempotency-Key", 160);
      const body = request.body || {};
      const slug = normalizeSlug(body.slug);
      if (slug.length < 3 || slug.length > 50 || RESERVED_SLUGS.has(slug)) {
        throw new ApiError(422, "invalid_slug", "الرابط الفرعي غير صالح أو محجوز");
      }
      const name = requiredText(body.name, "اسم المتجر", 120);
      const templateKey = body.templateKey || "general";
      if (!STORE_TEMPLATES.has(templateKey)) {
        throw new ApiError(422, "invalid_template", "القالب غير متاح");
      }
      const primaryColor = body.primaryColor || "#6d28d9";
      const secondaryColor = body.secondaryColor || "#111827";
      if (!isHexColor(primaryColor) || !isHexColor(secondaryColor)) {
        throw new ApiError(422, "invalid_color", "ألوان الهوية يجب أن تكون بصيغة Hex");
      }
      const requestHash = sha256(
        JSON.stringify({
          slug,
          name,
          templateKey,
          activityType: body.activityType,
          currency: body.currency
        })
      );
      const previous = await db.query(
        `SELECT * FROM idempotency_records
         WHERE user_id = $1 AND scope = 'store.create' AND idempotency_key = $2`,
        [user.id, idempotencyKey]
      );
      if (previous.rows[0]) {
        if (previous.rows[0].request_hash !== requestHash) {
          throw new ApiError(409, "idempotency_conflict", "استخدم مفتاح طلب جديدًا لهذه البيانات");
        }
        const stored = jsonValue(previous.rows[0].response_data, {});
        reply.code(200);
        return stored;
      }

      const storeId = randomUUID();
      const tenantId = randomUUID();
      const jobId = randomUUID();
      const roleId = randomUUID();
      const response = await db.transaction(async (client) => {
        const subscriptionResult = await client.query(
          `SELECT * FROM subscriptions
           WHERE user_id = $1 AND tenant_id IS NULL AND status IN ('trial', 'active')
             AND ends_at > NOW()
           ORDER BY created_at
           LIMIT 1`,
          [user.id]
        );
        const subscription = subscriptionResult.rows[0];
        if (!subscription) {
          throw new ApiError(409, "subscription_required", "يلزم اشتراك UCHIHA Full غير مستخدم");
        }
        const slugTaken = await client.query("SELECT 1 FROM stores WHERE slug = $1", [slug]);
        if (slugTaken.rows[0]) throw new ApiError(409, "slug_taken", "الرابط الفرعي مستخدم");

        await client.query(
          `INSERT INTO tenants (id, slug, name, status)
           VALUES ($1, $2, $3, 'provisioning_store')`,
          [tenantId, slug, name]
        );
        await client.query(
          `INSERT INTO stores (
             id, tenant_id, name, slug, activity_type, description, country,
             language, currency, template_key, status, contact_data, welcome_message
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             'provisioning_store', $11, $12
           )`,
          [
            storeId,
            tenantId,
            name,
            slug,
            requiredText(body.activityType, "نوع النشاط", 80),
            optionalText(body.description, 1500),
            requiredText(body.country, "الدولة", 80),
            requiredText(body.language, "اللغة", 10),
            requiredText(body.currency, "العملة", 3).toUpperCase(),
            templateKey,
            {
              email: optionalText(body.email, 200),
              phone: optionalText(body.phone, 40),
              whatsapp: optionalText(body.whatsapp, 40),
              telegram: optionalText(body.telegram, 80),
              socialLinks: body.socialLinks || {}
            },
            optionalText(body.welcomeMessage, 500) || `مرحبًا بك في ${name}`
          ]
        );
        await client.query(
          `INSERT INTO store_design_tokens (
             tenant_id, store_id, primary_color, secondary_color, background_color,
             surface_color, text_color, muted_text_color, border_color, success_color,
             warning_color, danger_color, font_family, border_radius, button_style,
             card_style, logo_url, favicon_url, cover_url
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18, $19
           )`,
          [
            tenantId,
            storeId,
            primaryColor,
            secondaryColor,
            body.backgroundColor || "#f8fafc",
            body.surfaceColor || "#ffffff",
            body.textColor || "#111827",
            body.mutedTextColor || "#64748b",
            body.borderColor || "#e2e8f0",
            body.successColor || "#15803d",
            body.warningColor || "#b45309",
            body.dangerColor || "#b91c1c",
            body.fontFamily || "Tajawal",
            body.borderRadius || "16px",
            body.buttonStyle || "solid",
            body.cardStyle || "bordered",
            optionalText(body.logoUrl, 1000) || null,
            optionalText(body.faviconUrl, 1000) || null,
            optionalText(body.coverUrl, 1000) || null
          ]
        );
        await client.query(
          `INSERT INTO domains (
             id, tenant_id, store_id, hostname, domain_type, status, is_primary, ssl_status
           ) VALUES ($1, $2, $3, $4, 'subdomain', 'active', TRUE, 'managed')`,
          [randomUUID(), tenantId, storeId, `${slug}.${config.storeBaseDomain}`]
        );
        await client.query(
          `INSERT INTO tenant_memberships (tenant_id, user_id, role_key)
           VALUES ($1, $2, 'owner')`,
          [tenantId, user.id]
        );
        await client.query(
          `INSERT INTO roles (id, tenant_id, role_key, name, is_system)
           VALUES ($1, $2, 'owner', 'مالك المتجر', TRUE)`,
          [roleId, tenantId]
        );
        const permissions = [
          ["store.manage", "إدارة المتجر"],
          ["catalog.manage", "إدارة الكتالوج"],
          ["orders.manage", "إدارة الطلبات"],
          ["payments.manage", "إدارة المدفوعات"],
          ["staff.manage", "إدارة الموظفين"],
          ["integrations.manage", "إدارة التكاملات"],
          ["audit.read", "قراءة سجل النشاط"]
        ];
        for (const [key, description] of permissions) {
          await client.query(
            `INSERT INTO permissions (permission_key, description)
             VALUES ($1, $2) ON CONFLICT (permission_key) DO NOTHING`,
            [key, description]
          );
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_key)
             VALUES ($1, $2) ON CONFLICT (role_id, permission_key) DO NOTHING`,
            [roleId, key]
          );
        }
        await client.query(
          `INSERT INTO membership_roles (tenant_id, user_id, role_id)
           VALUES ($1, $2, $3)`,
          [tenantId, user.id, roleId]
        );
        await client.query("UPDATE subscriptions SET tenant_id = $2 WHERE id = $1", [
          subscription.id,
          tenantId
        ]);
        await client.query(
          `INSERT INTO provisioning_jobs (
             id, tenant_id, store_id, job_type, status, stage, idempotency_key
           ) VALUES ($1, $2, $3, 'create_store', 'queued', 'reserve_store', $4)`,
          [jobId, tenantId, storeId, `store-create:${user.id}:${idempotencyKey}`]
        );
        await client.query(
          `INSERT INTO audit_logs (
             id, tenant_id, actor_user_id, action, entity_type, entity_id,
             ip_address, after_data
           ) VALUES ($1, $2, $3, 'store.create_requested', 'store', $4, $5, $6)`,
          [randomUUID(), tenantId, user.id, storeId, request.ip, { slug, name, templateKey }]
        );
        await client.query(
          `INSERT INTO outbox_events (
             id, tenant_id, aggregate_type, aggregate_id, event_type, payload
           ) VALUES ($1, $2, 'store', $3, 'store.provisioning_requested', $4)`,
          [randomUUID(), tenantId, storeId, { jobId }]
        );
        const payload = {
          store: {
            id: storeId,
            tenantId,
            name,
            slug,
            status: "provisioning_store",
            links: {
              storefront: `${config.appBaseUrl}/store/${slug}`,
              dashboard: `${config.appBaseUrl}/admin/${storeId}`,
              subdomain: `https://${slug}.${config.storeBaseDomain}`
            }
          },
          provisioningJobId: jobId
        };
        await client.query(
          `INSERT INTO idempotency_records (
             id, user_id, scope, idempotency_key, request_hash, resource_id, response_data
           ) VALUES ($1, $2, 'store.create', $3, $4, $5, $6)`,
          [randomUUID(), user.id, idempotencyKey, requestHash, storeId, payload]
        );
        return payload;
      });
      reply.code(202);
      return response;
    })
  );

  app.get(
    "/api/stores",
    route(async (request) => {
      const user = await authenticate(db, request);
      const result = await db.query(
        `SELECT s.*, tm.role_key
         FROM stores s
         JOIN tenant_memberships tm ON tm.tenant_id = s.tenant_id
         WHERE tm.user_id = $1 AND tm.status = 'active'
         ORDER BY s.created_at`,
        [user.id]
      );
      return { stores: result.rows.map((row) => ({ ...storeDto(config, row), role: row.role_key })) };
    })
  );

  app.get(
    "/api/stores/:storeId",
    route(async (request) => {
      const user = await authenticate(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const design = (
        await db.query(
          "SELECT * FROM store_design_tokens WHERE tenant_id = $1 AND store_id = $2",
          [store.tenant_id, store.id]
        )
      ).rows[0];
      const bots = await db.query(
        `SELECT id, purpose, telegram_bot_id, username, token_masked, status, last_checked_at
         FROM bot_connections WHERE tenant_id = $1 AND store_id = $2 ORDER BY purpose`,
        [store.tenant_id, store.id]
      );
      const counts = (
        await db.query(
          `SELECT
             (SELECT COUNT(*)::int FROM categories WHERE tenant_id = $1 AND store_id = $2) AS categories,
             (SELECT COUNT(*)::int FROM products WHERE tenant_id = $1 AND store_id = $2) AS products,
             (SELECT COUNT(*)::int FROM orders WHERE tenant_id = $1 AND store_id = $2) AS orders`,
          [store.tenant_id, store.id]
        )
      ).rows[0];
      return {
        store: storeDto(config, store, design),
        bots: bots.rows.map((row) => ({
          id: row.id,
          purpose: row.purpose,
          botId: row.telegram_bot_id,
          username: row.username,
          token: row.token_masked,
          status: row.status,
          lastCheckedAt: row.last_checked_at
        })),
        counts
      };
    })
  );

  app.post(
    "/api/stores/:storeId/categories",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const name = requiredText(request.body?.name, "اسم القسم", 120);
      const parentId = optionalText(request.body?.parentId, 80) || null;
      if (parentId) {
        const parent = (
          await db.query(
            `SELECT id, parent_id FROM categories
             WHERE id = $1 AND tenant_id = $2 AND store_id = $3 AND status = 'active'`,
            [parentId, store.tenant_id, store.id]
          )
        ).rows[0];
        if (!parent) throw new ApiError(422, "invalid_parent_category", "القسم الرئيسي لا يتبع هذا المتجر");
        if (parent.parent_id) {
          throw new ApiError(422, "category_depth_exceeded", "يدعم القالب قسمًا رئيسيًا ثم قسمًا فرعيًا فقط");
        }
      }
      const id = randomUUID();
      const slugBase = normalizeSlug(request.body?.slug || name) || "category";
      const slug = `${slugBase}-${id.slice(0, 6)}`;
      await db.query(
        `INSERT INTO categories (
           id, tenant_id, store_id, parent_id, name, slug, image_url, sort_order, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
        [
          id,
          store.tenant_id,
          store.id,
          parentId,
          name,
          slug,
          optionalText(request.body?.imageUrl, 1000) || null,
          integer(request.body?.sortOrder ?? 0, { minimum: 0, maximum: 100000, field: "الترتيب" })
        ]
      );
      await db.query(
        `INSERT INTO audit_logs (
           id, tenant_id, actor_user_id, action, entity_type, entity_id, ip_address, after_data
         ) VALUES ($1, $2, $3, 'category.created', 'category', $4, $5, $6)`,
        [randomUUID(), store.tenant_id, user.id, id, request.ip, { name, slug, parentId }]
      );
      const category = (await db.query("SELECT * FROM categories WHERE id = $1", [id])).rows[0];
      return { category: categoryDto(category) };
    })
  );

  app.get(
    "/api/stores/:storeId/categories",
    route(async (request) => {
      const user = await authenticate(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const result = await db.query(
        `SELECT * FROM categories
         WHERE tenant_id = $1 AND store_id = $2
         ORDER BY sort_order, created_at`,
        [store.tenant_id, store.id]
      );
      return { categories: result.rows.map(categoryDto) };
    })
  );

  app.post(
    "/api/stores/:storeId/products",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const productType = body.productType || "digital";
      const deliveryMode = body.deliveryMode || "manual";
      if (!PRODUCT_TYPES.has(productType)) throw new ApiError(422, "invalid_product_type", "نوع المنتج غير صالح");
      if (!DELIVERY_MODES.has(deliveryMode)) throw new ApiError(422, "invalid_delivery", "طريقة التسليم غير صالحة");
      if (body.categoryId) {
        const category = await db.query(
          `SELECT 1 FROM categories
           WHERE id = $1 AND tenant_id = $2 AND store_id = $3`,
          [body.categoryId, store.tenant_id, store.id]
        );
        if (!category.rows[0]) throw new ApiError(422, "invalid_category", "القسم لا يتبع هذا المتجر");
      }
      const name = requiredText(body.name, "اسم المنتج", 160);
      const slug = await uniqueProductSlug(db, store.tenant_id, body.slug || name);
      const id = randomUUID();
      const media = resolveProductMedia(body, productType, name);
      await db.query(
        `INSERT INTO products (
           id, tenant_id, store_id, category_id, product_type, name, slug,
           description, image_url, price_minor, currency, stock_quantity,
           min_quantity, max_quantity, delivery_mode, source_kind, fields,
           options, metadata, sort_order, status
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, 'local', $16, $17, $18, $19, $20
         )`,
        [
          id,
          store.tenant_id,
          store.id,
          body.categoryId || null,
          productType,
          name,
          slug,
          optionalText(body.description, 4000),
          media.imageUrl,
          integer(body.priceMinor, { minimum: 0, field: "السعر" }),
          store.currency,
          body.stockQuantity === null || body.stockQuantity === undefined
            ? null
            : integer(body.stockQuantity, { minimum: 0, field: "المخزون" }),
          integer(body.minimumQuantity ?? 1, { minimum: 1, field: "الحد الأدنى" }),
          body.maximumQuantity === null || body.maximumQuantity === undefined
            ? null
            : integer(body.maximumQuantity, { minimum: 1, field: "الحد الأعلى" }),
          deliveryMode,
          Array.isArray(body.fields) ? body.fields : [],
          Array.isArray(body.options) ? body.options : [],
          media.metadata,
          integer(body.sortOrder ?? 0, { minimum: 0, maximum: 100000, field: "الترتيب" }),
          body.status === "hidden" ? "hidden" : "active"
        ]
      );
      const product = (await db.query("SELECT * FROM products WHERE id = $1", [id])).rows[0];
      await db.query(
        `INSERT INTO outbox_events (
           id, tenant_id, aggregate_type, aggregate_id, event_type, payload
         ) VALUES ($1, $2, 'product', $3, 'product.created', $4)`,
        [randomUUID(), store.tenant_id, id, { storeId: store.id }]
      );
      return { product: productDto(product) };
    })
  );

  app.patch(
    "/api/stores/:storeId/products/:productId/media",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const product = (
        await db.query(
          `SELECT * FROM products
           WHERE id = $1 AND tenant_id = $2 AND store_id = $3`,
          [request.params.productId, store.tenant_id, store.id]
        )
      ).rows[0];
      if (!product) throw new ApiError(404, "product_not_found", "المنتج غير موجود");
      const media = resolveProductMedia(request.body || {}, product.product_type, product.name);
      const metadata = {
        ...jsonValue(product.metadata, {}),
        ...media.metadata
      };
      await db.query(
        `UPDATE products
         SET image_url = $1, metadata = $2, updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4 AND store_id = $5`,
        [media.imageUrl, metadata, product.id, store.tenant_id, store.id]
      );
      await db.query(
        `INSERT INTO audit_logs (
           id, tenant_id, actor_user_id, action, entity_type, entity_id,
           ip_address, before_data, after_data
         ) VALUES ($1, $2, $3, 'product.media_updated', 'product', $4, $5, $6, $7)`,
        [
          randomUUID(),
          store.tenant_id,
          user.id,
          product.id,
          request.ip,
          { imageUrl: product.image_url, media: jsonValue(product.metadata, {}).media || null },
          { imageUrl: media.imageUrl, media: media.metadata.media }
        ]
      );
      const updated = (await db.query("SELECT * FROM products WHERE id = $1", [product.id])).rows[0];
      return { product: productDto(updated) };
    })
  );

  app.get(
    "/api/stores/:storeId/products",
    route(async (request) => {
      const user = await authenticate(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const result = await db.query(
        `SELECT * FROM products
         WHERE tenant_id = $1 AND store_id = $2
         ORDER BY sort_order, created_at`,
        [store.tenant_id, store.id]
      );
      return { products: result.rows.map(productDto) };
    })
  );

  app.post(
    "/api/stores/:storeId/bots",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const storefrontToken = requiredText(body.storefrontToken, "توكن بوت المتجر", 250);
      const adminToken = requiredText(body.adminToken, "توكن بوت الإدارة", 250);
      if (storefrontToken === adminToken) {
        throw new ApiError(422, "duplicate_bot_tokens", "يجب استخدام بوتين مختلفين");
      }
      const gateway = new TelegramGateway(config, request.log);
      let storefrontBot;
      let adminBot;
      try {
        [storefrontBot, adminBot] = await Promise.all([
          gateway.validateToken(storefrontToken, "storefront"),
          gateway.validateToken(adminToken, "admin")
        ]);
      } catch (error) {
        throw new ApiError(422, "telegram_token_invalid", error.message);
      }
      if (String(storefrontBot.id) === String(adminBot.id)) {
        throw new ApiError(422, "duplicate_bots", "التوكنان يعودان إلى البوت نفسه");
      }
      const existing = await db.query(
        "SELECT * FROM bot_connections WHERE tenant_id = $1 AND store_id = $2",
        [store.tenant_id, store.id]
      );
      if (existing.rows.length) {
        throw new ApiError(409, "bots_already_configured", "البوتات مرتبطة مسبقًا؛ استخدم تدوير التوكن لاحقًا");
      }
      const connections = [
        { purpose: "storefront", token: storefrontToken, bot: storefrontBot },
        { purpose: "admin", token: adminToken, bot: adminBot }
      ];
      const responseBots = [];
      await db.transaction(async (client) => {
        for (const item of connections) {
          const webhookSecret = randomToken(32);
          const id = randomUUID();
          await client.query(
            `INSERT INTO bot_connections (
               id, tenant_id, store_id, purpose, telegram_bot_id, username,
               token_ciphertext, token_fingerprint, token_masked,
               webhook_secret_ciphertext, webhook_secret_hash, status, last_checked_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'validated', NOW()
             )`,
            [
              id,
              store.tenant_id,
              store.id,
              item.purpose,
              String(item.bot.id),
              item.bot.username,
              encryptSecret(item.token, config.encryptionKey),
              sha256(item.token),
              maskSecret(item.token),
              encryptSecret(webhookSecret, config.encryptionKey),
              sha256(webhookSecret)
            ]
          );
          responseBots.push({
            id,
            purpose: item.purpose,
            username: item.bot.username,
            token: maskSecret(item.token),
            status: "validated"
          });
        }
        const contactData = jsonValue(store.contact_data, {});
        contactData.telegramOwnerId = optionalText(body.ownerTelegramId, 40);
        await client.query("UPDATE stores SET contact_data = $2, updated_at = NOW() WHERE id = $1", [
          store.id,
          contactData
        ]);
        await client.query(
          `INSERT INTO provisioning_jobs (
             id, tenant_id, store_id, job_type, status, stage, idempotency_key
           ) VALUES ($1, $2, $3, 'connect_bots', 'queued', 'validate_bots', $4)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            randomUUID(),
            store.tenant_id,
            store.id,
            `connect-bots:${store.id}:${sha256(storefrontToken).slice(0, 12)}:${sha256(adminToken).slice(0, 12)}`
          ]
        );
        await client.query(
          `INSERT INTO audit_logs (
             id, tenant_id, actor_user_id, action, entity_type, entity_id,
             ip_address, after_data
           ) VALUES ($1, $2, $3, 'bots.validated', 'store', $4, $5, $6)`,
          [
            randomUUID(),
            store.tenant_id,
            user.id,
            store.id,
            request.ip,
            { bots: responseBots.map(({ purpose, username }) => ({ purpose, username })) }
          ]
        );
      }, store.tenant_id);
      return { bots: responseBots, status: "queued_for_webhook_setup" };
    })
  );

  app.get(
    "/api/library/providers",
    route(async (request) => {
      await authenticate(db, request);
      const result = await db.query(
        `SELECT id, public_alias, currency, test_mode, connection_status, last_checked_at
         FROM api_providers ORDER BY public_alias`
      );
      return {
        providers: result.rows.map((row) =>
          publicProvider({
            id: row.id,
            public_alias: row.public_alias,
            currency: row.currency,
            test_mode: row.test_mode,
            connection_status: row.connection_status,
            last_checked_at: row.last_checked_at
          })
        )
      };
    })
  );

  app.get(
    "/api/library/categories",
    route(async (request) => {
      await authenticate(db, request);
      const result = await db.query(
        `SELECT c.id, c.public_name, c.status, p.id AS provider_id, p.public_alias
         FROM api_categories c
         JOIN api_providers p ON p.id = c.provider_id
         WHERE c.status = 'active'
         ORDER BY c.public_name`
      );
      return {
        categories: result.rows.map((row) => ({
          id: row.id,
          name: row.public_name,
          source: row.public_alias,
          providerId: row.provider_id
        }))
      };
    })
  );

  app.get(
    "/api/library/services",
    route(async (request) => {
      await authenticate(db, request);
      const values = [];
      let filter = "";
      if (request.query?.categoryId) {
        values.push(request.query.categoryId);
        filter = `AND s.api_category_id = $${values.length}`;
      }
      const result = await db.query(
        `SELECT s.id, s.api_category_id, s.public_name, s.public_description,
                s.currency, s.minimum_quantity, s.maximum_quantity, s.fields, s.options,
                p.id AS provider_id, p.public_alias, p.connection_status, p.test_mode,
                p.sync_settings, s.original_cost_minor
         FROM api_services s
         JOIN api_providers p ON p.id = s.provider_id
         WHERE s.provider_status = 'active' ${filter}
         ORDER BY s.public_name`,
        values
      );
      return {
        services: result.rows.map((row) => {
          const calculated = pricing(
            { original_cost_minor: row.original_cost_minor },
            { sync_settings: row.sync_settings },
            { profitMode: "fixed", profitValue: 0 }
          );
          return {
            id: row.id,
            categoryId: row.api_category_id,
            name: row.public_name,
            description: row.public_description,
            source: row.public_alias,
            providerId: row.provider_id,
            wholesalePriceMinor: calculated.uchihaCost,
            currency: row.currency,
            minimumQuantity: Number(row.minimum_quantity),
            maximumQuantity: row.maximum_quantity === null ? null : Number(row.maximum_quantity),
            fields: jsonArray(row.fields),
            options: jsonArray(row.options),
            testMode: row.test_mode
          };
        })
      };
    })
  );

  app.post(
    "/api/platform/providers/:providerId/sync",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      requirePlatformAdmin(user);
      return syncProvider(db, request.params.providerId, config, request.log);
    })
  );

  app.post(
    "/api/stores/:storeId/library/import",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const serviceResult = await db.query(
        `SELECT s.*, p.public_alias, p.sync_settings, p.connection_status
         FROM api_services s
         JOIN api_providers p ON p.id = s.provider_id
         WHERE s.id = $1 AND s.provider_status = 'active'`,
        [body.serviceId]
      );
      const service = serviceResult.rows[0];
      if (!service) throw new ApiError(404, "service_not_found", "الخدمة غير موجودة");
      const price = pricing(service, service, body);
      let categoryId = body.categoryId || null;
      if (categoryId) {
        const category = await db.query(
          "SELECT 1 FROM categories WHERE id = $1 AND tenant_id = $2 AND store_id = $3",
          [categoryId, store.tenant_id, store.id]
        );
        if (!category.rows[0]) throw new ApiError(422, "invalid_category", "القسم لا يتبع هذا المتجر");
      } else if (body.newCategoryName) {
        categoryId = randomUUID();
        const categoryName = requiredText(body.newCategoryName, "اسم القسم", 120);
        await db.query(
          `INSERT INTO categories (id, tenant_id, store_id, name, slug, status)
           VALUES ($1, $2, $3, $4, $5, 'active')`,
          [
            categoryId,
            store.tenant_id,
            store.id,
            categoryName,
            `${normalizeSlug(categoryName) || "services"}-${categoryId.slice(0, 6)}`
          ]
        );
      }
      const name = optionalText(body.name, 160) || service.public_name;
      const productId = randomUUID();
      const slug = await uniqueProductSlug(db, store.tenant_id, name);
      const media = resolveProductMedia(body, "api_service", name);
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO products (
             id, tenant_id, store_id, category_id, product_type, name, slug,
             description, image_url, price_minor, currency, min_quantity,
             max_quantity, delivery_mode, source_kind, fields, options, metadata,
             sort_order, status
           ) VALUES (
             $1, $2, $3, $4, 'api_service', $5, $6, $7, $8, $9, $10, $11,
             $12, 'provider_api', 'uchiha_api', $13, $14, $15, $16, $17
           )`,
          [
            productId,
            store.tenant_id,
            store.id,
            categoryId,
            name,
            slug,
            optionalText(body.description, 4000) || service.public_description,
            media.imageUrl,
            price.sellingPrice,
            store.currency,
            Number(service.minimum_quantity),
            service.maximum_quantity === null ? null : Number(service.maximum_quantity),
            jsonArray(service.fields),
            jsonArray(service.options),
            { librarySource: service.public_alias, ...media.metadata },
            integer(body.sortOrder ?? 0, { minimum: 0, maximum: 100000, field: "الترتيب" }),
            body.status === "hidden" ? "hidden" : "active"
          ]
        );
        await client.query(
          `INSERT INTO store_imported_services (
             id, tenant_id, store_id, provider_id, api_service_id, product_id,
             original_cost_minor, uchiha_cost_minor, selling_price_minor,
             profit_mode, profit_value, platform_profit_minor, merchant_profit_minor,
             sync_enabled, provider_status, local_status, last_sync_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16, NOW()
           )`,
          [
            randomUUID(),
            store.tenant_id,
            store.id,
            service.provider_id,
            service.id,
            productId,
            price.originalCost,
            price.uchihaCost,
            price.sellingPrice,
            price.mode,
            price.value,
            price.platformProfit,
            price.merchantProfit,
            body.syncEnabled !== false,
            service.provider_status,
            body.status === "hidden" ? "hidden" : "active"
          ]
        );
        await client.query(
          `INSERT INTO audit_logs (
             id, tenant_id, actor_user_id, action, entity_type, entity_id,
             ip_address, after_data
           ) VALUES ($1, $2, $3, 'library.service_imported', 'product', $4, $5, $6)`,
          [
            randomUUID(),
            store.tenant_id,
            user.id,
            productId,
            request.ip,
            {
              apiServiceId: service.id,
              sourceAlias: service.public_alias,
              sellingPriceMinor: price.sellingPrice
            }
          ]
        );
      }, store.tenant_id);
      const product = (await db.query("SELECT * FROM products WHERE id = $1", [productId])).rows[0];
      return { product: productDto(product), pricing: { ...price, originalCost: undefined } };
    })
  );

  app.get(
    "/api/library/programming-services",
    route(async (request) => {
      await authenticate(db, request);
      const result = await db.query(
        `SELECT id, name, description, image_url, starting_price_minor, currency,
                estimated_duration, fields, options
         FROM programming_services
         WHERE status = 'active' AND resale_enabled = TRUE
         ORDER BY created_at`
      );
      return {
        services: result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description,
          imageUrl: row.image_url,
          startingPriceMinor: Number(row.starting_price_minor),
          currency: row.currency,
          estimatedDuration: row.estimated_duration,
          fields: jsonArray(row.fields),
          options: jsonArray(row.options)
        }))
      };
    })
  );

  app.post(
    "/api/platform/programming-services",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      requirePlatformAdmin(user);
      const body = request.body || {};
      const id = randomUUID();
      await db.query(
        `INSERT INTO programming_services (
           id, name, description, image_url, starting_price_minor, currency,
           estimated_duration, fields, options, resale_enabled, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active')`,
        [
          id,
          requiredText(body.name, "اسم الخدمة", 160),
          optionalText(body.description, 4000),
          optionalText(body.imageUrl, 1000) || null,
          integer(body.startingPriceMinor ?? 0, { minimum: 0, field: "السعر الابتدائي" }),
          requiredText(body.currency, "العملة", 3).toUpperCase(),
          optionalText(body.estimatedDuration, 120) || null,
          Array.isArray(body.fields) ? body.fields : [],
          Array.isArray(body.options) ? body.options : [],
          body.resaleEnabled !== false
        ]
      );
      return { service: (await db.query("SELECT * FROM programming_services WHERE id = $1", [id])).rows[0] };
    })
  );

  app.post(
    "/api/stores/:storeId/programming-services/import",
    route(async (request) => {
      const user = await authenticate(db, request);
      requireCsrf(request, user);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const body = request.body || {};
      const service = (
        await db.query(
          `SELECT * FROM programming_services
           WHERE id = $1 AND status = 'active' AND resale_enabled = TRUE`,
          [body.serviceId]
        )
      ).rows[0];
      if (!service) throw new ApiError(404, "service_not_found", "خدمة البرمجة غير متاحة");
      const margin = integer(body.merchantMarginMinor ?? 0, {
        minimum: 0,
        field: "هامش الربح"
      });
      const productId = randomUUID();
      const name = optionalText(body.name, 160) || service.name;
      const slug = await uniqueProductSlug(db, store.tenant_id, name);
      const media =
        body.imageUrl || body.mediaKey || !service.image_url
          ? resolveProductMedia(body, "programming_service", name)
          : {
              imageUrl: service.image_url,
              metadata: { media: { source: "platform", key: null, locked: false } }
            };
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO products (
             id, tenant_id, store_id, category_id, product_type, name, slug,
             description, image_url, price_minor, currency, delivery_mode,
             source_kind, fields, options, metadata, status
           ) VALUES (
             $1, $2, $3, $4, 'programming_service', $5, $6, $7, $8, $9, $10,
             'manual', 'programming', $11, $12, $13, 'active'
           )`,
          [
            productId,
            store.tenant_id,
            store.id,
            body.categoryId || null,
            name,
            slug,
            optionalText(body.description, 4000) || service.description,
            media.imageUrl,
            Number(service.starting_price_minor) + margin,
            store.currency,
            jsonArray(service.fields),
            jsonArray(service.options),
            {
              quotationRequired: true,
              source: "UCHIHA Programming Services",
              ...media.metadata
            }
          ]
        );
        await client.query(
          `INSERT INTO store_programming_services (
             id, tenant_id, store_id, programming_service_id, product_id, merchant_margin_minor
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), store.tenant_id, store.id, service.id, productId, margin]
        );
      }, store.tenant_id);
      const product = (await db.query("SELECT * FROM products WHERE id = $1", [productId])).rows[0];
      return { product: productDto(product) };
    })
  );

  app.get(
    "/api/storefront/:slug",
    route(async (request) => {
      const slug = normalizeSlug(request.params.slug);
      const result = await db.query("SELECT * FROM stores WHERE slug = $1", [slug]);
      const store = result.rows[0];
      if (!store) throw new ApiError(404, "store_not_found", "المتجر غير موجود");
      let canPreview = false;
      if (store.status !== "active" && String(request.query?.preview) === "1") {
        try {
          const user = await authenticate(db, request);
          await requireStoreAccess(db, user, store.id);
          canPreview = true;
        } catch {
          canPreview = false;
        }
      }
      if (store.status !== "active" && !canPreview) {
        throw new ApiError(404, "store_not_active", "المتجر غير متاح حاليًا");
      }
      const [design, categories, products] = await Promise.all([
        db.query(
          "SELECT * FROM store_design_tokens WHERE tenant_id = $1 AND store_id = $2",
          [store.tenant_id, store.id]
        ),
        db.query(
          `SELECT id, parent_id, name, slug, image_url, sort_order, status
           FROM categories
           WHERE tenant_id = $1 AND store_id = $2 AND status = 'active'
           ORDER BY sort_order, created_at`,
          [store.tenant_id, store.id]
        ),
        db.query(
          `SELECT * FROM products
           WHERE tenant_id = $1 AND store_id = $2 AND status = 'active'
           ORDER BY sort_order, created_at`,
          [store.tenant_id, store.id]
        )
      ]);
      return {
        store: storeDto(config, store, design.rows[0]),
        categories: categories.rows.map(categoryDto),
        products: products.rows.map(productDto),
        preview: canPreview
      };
    })
  );

  app.post(
    "/api/storefront/:slug/orders",
    route(async (request, reply) => {
      const slug = normalizeSlug(request.params.slug);
      const store = (await db.query("SELECT * FROM stores WHERE slug = $1 AND status = 'active'", [slug])).rows[0];
      if (!store) throw new ApiError(404, "store_not_active", "المتجر غير متاح");
      const idempotencyKey = requiredText(request.headers["idempotency-key"], "Idempotency-Key", 160);
      const body = request.body || {};
      const product = (
        await db.query(
          `SELECT * FROM products
           WHERE id = $1 AND tenant_id = $2 AND store_id = $3 AND status = 'active'`,
          [body.productId, store.tenant_id, store.id]
        )
      ).rows[0];
      if (!product) throw new ApiError(404, "product_not_found", "المنتج غير متاح");
      const quantity = integer(body.quantity ?? 1, {
        minimum: Number(product.min_quantity),
        maximum: product.max_quantity === null ? 100000 : Number(product.max_quantity),
        field: "الكمية"
      });
      const fields = jsonArray(product.fields);
      const inputs = body.inputs && typeof body.inputs === "object" ? body.inputs : {};
      for (const field of fields) {
        if (field.required && !String(inputs[field.key] || "").trim()) {
          throw new ApiError(422, "required_product_field", `الحقل ${field.label || field.key} مطلوب`);
        }
      }
      const total = Number(product.price_minor) * quantity;
      const testPayment = Boolean(body.testPayment);
      if (testPayment && !config.allowDemoBilling) {
        throw new ApiError(403, "demo_payment_disabled", "الدفع التجريبي غير متاح");
      }
      const orderId = randomUUID();
      const orderNumber = `UCH-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
      try {
        await db.transaction(async (client) => {
          await client.query(
            `INSERT INTO orders (
               id, tenant_id, store_id, order_number, customer_name, customer_email,
               customer_telegram_id, channel, status, payment_status, total_minor,
               currency, idempotency_key
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, 'web', $8, $9, $10, $11, $12
             )`,
            [
              orderId,
              store.tenant_id,
              store.id,
              orderNumber,
              requiredText(body.customerName, "اسم العميل", 120),
              optionalText(body.customerEmail, 200) || null,
              optionalText(body.customerTelegramId, 40) || null,
              testPayment ? "paid" : "awaiting_payment",
              testPayment ? "paid" : "unpaid",
              total,
              product.currency,
              idempotencyKey
            ]
          );
          await client.query(
            `INSERT INTO order_items (
               id, tenant_id, order_id, product_id, product_name_snapshot,
               product_type_snapshot, quantity, unit_price_minor, total_minor, input_data
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              randomUUID(),
              store.tenant_id,
              orderId,
              product.id,
              product.name,
              product.product_type,
              quantity,
              Number(product.price_minor),
              total,
              inputs
            ]
          );
          if (product.source_kind === "uchiha_api" && testPayment) {
            const imported = (
              await client.query(
                `SELECT * FROM store_imported_services
                 WHERE tenant_id = $1 AND store_id = $2 AND product_id = $3`,
                [store.tenant_id, store.id, product.id]
              )
            ).rows[0];
            if (!imported) throw new ApiError(409, "provider_mapping_missing", "ربط خدمة API غير مكتمل");
            await client.query(
              `INSERT INTO provider_orders (
                 id, tenant_id, store_id, order_id, provider_id, api_service_id,
                 status, idempotency_key, request_payload
               ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
              [
                randomUUID(),
                store.tenant_id,
                store.id,
                orderId,
                imported.provider_id,
                imported.api_service_id,
                `provider:${store.tenant_id}:${idempotencyKey}`,
                { quantity, inputs }
              ]
            );
          }
          await client.query(
            `INSERT INTO outbox_events (
               id, tenant_id, aggregate_type, aggregate_id, event_type, payload
             ) VALUES ($1, $2, 'order', $3, 'order.created', $4)`,
            [randomUUID(), store.tenant_id, orderId, { orderNumber, sourceKind: product.source_kind }]
          );
        }, store.tenant_id);
      } catch (error) {
        if (error.code === "23505") {
          const previous = await db.query(
            `SELECT * FROM orders
             WHERE tenant_id = $1 AND idempotency_key = $2`,
            [store.tenant_id, idempotencyKey]
          );
          if (previous.rows[0]) {
            reply.code(200);
            return {
              order: {
                id: previous.rows[0].id,
                orderNumber: previous.rows[0].order_number,
                status: previous.rows[0].status,
                paymentStatus: previous.rows[0].payment_status,
                totalMinor: Number(previous.rows[0].total_minor),
                currency: previous.rows[0].currency
              },
              duplicate: true
            };
          }
        }
        throw error;
      }
      reply.code(201);
      return {
        order: {
          id: orderId,
          orderNumber,
          status: testPayment ? "paid" : "awaiting_payment",
          paymentStatus: testPayment ? "paid" : "unpaid",
          totalMinor: total,
          currency: product.currency
        },
        providerExecution: product.source_kind === "uchiha_api" && testPayment ? "queued_test_safe" : null
      };
    })
  );

  app.get(
    "/api/stores/:storeId/orders",
    route(async (request) => {
      const user = await authenticate(db, request);
      const store = await requireStoreAccess(db, user, request.params.storeId);
      const result = await db.query(
        `SELECT * FROM orders
         WHERE tenant_id = $1 AND store_id = $2
         ORDER BY created_at DESC`,
        [store.tenant_id, store.id]
      );
      return {
        orders: result.rows.map((row) => ({
          id: row.id,
          orderNumber: row.order_number,
          customerName: row.customer_name,
          channel: row.channel,
          status: row.status,
          paymentStatus: row.payment_status,
          totalMinor: Number(row.total_minor),
          currency: row.currency,
          createdAt: row.created_at
        }))
      };
    })
  );

  app.post(
    "/webhooks/telegram/:connectionId",
    route(async (request, reply) => {
      const connection = (
        await db.query("SELECT * FROM bot_connections WHERE id = $1 AND status = 'active'", [
          request.params.connectionId
        ])
      ).rows[0];
      if (!connection) throw new ApiError(404, "bot_connection_not_found", "Bot connection not found");
      const providedSecret = request.headers["x-telegram-bot-api-secret-token"];
      if (!providedSecret || sha256(providedSecret) !== connection.webhook_secret_hash) {
        throw new ApiError(403, "invalid_webhook_secret", "Invalid webhook secret");
      }
      const response = await handleTelegramUpdate(db, connection, request.body || {});
      if (response) {
        const gateway = new TelegramGateway(config, request.log);
        const token = decryptSecret(connection.token_ciphertext, config.encryptionKey);
        await gateway.sendMessage(token, response.chatId, response.text);
      }
      reply.code(204);
      return null;
    })
  );

  let stopWorkers = null;
  if (startWorkers) {
    stopWorkers = startWorkerLoop(db, config, app.log);
  }
  app.addHook("onClose", async () => {
    stopWorkers?.();
  });
  return app;
}
