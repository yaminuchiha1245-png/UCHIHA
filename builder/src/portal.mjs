import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { encryptSecret, sha256 } from "./security.mjs";

const CONTACT_TYPES = new Set([
  "whatsapp",
  "telegram",
  "email",
  "instagram",
  "tiktok",
  "facebook",
  "discord",
  "phone",
  "website",
  "custom"
]);
const SERVICE_STATUSES = new Set(["active", "hidden", "coming_soon"]);
const CONTENT_STATUSES = new Set(["active", "hidden"]);
const CONTACT_STATUSES = new Set(["active", "hidden", "disabled"]);
const PAYMENT_STATUSES = new Set(["active", "hidden", "disabled", "coming_soon"]);
const REQUEST_STATUSES = new Set([
  "new",
  "contacted",
  "quoted",
  "approved",
  "in_progress",
  "completed",
  "cancelled",
  "rejected"
]);
const QR_MODES = new Set(["none", "generated", "uploaded"]);
const PROVIDER_ADAPTERS = new Set(["mock", "http-json-v1"]);
const PROVIDER_STATUSES = new Set(["active", "disabled"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class PortalError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function text(value, maximum = 1000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, maximum);
}

function required(value, field, maximum = 1000) {
  const result = text(value, maximum);
  if (!result) throw new PortalError(422, "missing_field", `${field} is required`);
  return result;
}

function uuid(value, field = "id") {
  const result = text(value, 80);
  if (!UUID_PATTERN.test(result)) throw new PortalError(422, "invalid_id", `${field} is invalid`);
  return result;
}

function integer(value, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new PortalError(422, "invalid_number", "A numeric value is invalid");
  }
  return parsed;
}

function status(value, supported, fallback) {
  const normalized = text(value, 40) || fallback;
  if (!supported.has(normalized)) throw new PortalError(422, "invalid_status", "Status is invalid");
  return normalized;
}

function stringList(value, maximumItems = 8, maximumLength = 180) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maximumItems)
    .map((item) => text(item, maximumLength))
    .filter(Boolean);
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

function safeAssetUrl(value, field = "asset URL", { nullable = true } = {}) {
  const candidate = text(value, 750000);
  if (!candidate && nullable) return null;
  if (candidate.startsWith("/assets/") && !candidate.includes("..")) return candidate;
  if (candidate.startsWith("data:")) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(candidate);
    if (!match) {
      throw new PortalError(422, "invalid_asset_upload", `${field} must be PNG, JPEG, or WebP`);
    }
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length < 32 || bytes.length > 512000) {
      throw new PortalError(422, "invalid_asset_size", `${field} must be between 32 bytes and 500 KB`);
    }
    const png = match[1].toLowerCase() === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = match[1].toLowerCase() === "jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp = match[1].toLowerCase() === "webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
    if (!png && !jpeg && !webp) {
      throw new PortalError(422, "invalid_asset_content", `${field} content does not match its image type`);
    }
    return candidate;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PortalError(422, "invalid_asset_url", `${field} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PortalError(422, "invalid_asset_url", `${field} must be a safe HTTPS URL`);
  }
  return parsed.toString();
}

function safeActionUrl(value, field = "link") {
  const candidate = text(value, 1200);
  if (!candidate) return "/";
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("..")) {
    return candidate;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new PortalError(422, "invalid_link", `${field} is invalid`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new PortalError(422, "invalid_link", `${field} must be a safe HTTPS URL`);
  }
  return parsed.toString();
}

function contactTarget(type, value) {
  const target = required(value, "target", 1000);
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    throw new PortalError(422, "invalid_contact_target", "Email address is invalid");
  }
  if (type === "phone" || type === "whatsapp") {
    const digits = target.replace(/[^\d+]/g, "");
    if (!/^\+?[1-9]\d{7,14}$/.test(digits)) {
      throw new PortalError(422, "invalid_contact_target", "Phone number is invalid");
    }
    return digits.startsWith("+") ? digits : `+${digits}`;
  }
  if (type === "website" || type === "custom") return safeActionUrl(target, "contact target");
  if (target.startsWith("@") && /^@[A-Za-z0-9_.-]{2,80}$/.test(target)) return target;
  return safeActionUrl(target, "contact target");
}

function serviceDto(row) {
  return {
    id: row.id,
    key: row.service_key,
    slug: row.slug,
    iconKey: row.icon_key,
    name: { ar: row.name_ar, en: row.name_en },
    description: { ar: row.description_ar, en: row.description_en },
    features: {
      ar: jsonValue(row.features_ar, []),
      en: jsonValue(row.features_en, [])
    },
    startingPriceMinor:
      row.starting_price_minor === null || row.starting_price_minor === undefined
        ? null
        : Number(row.starting_price_minor),
    currency: row.currency,
    estimatedDuration: {
      ar: row.estimated_duration_ar,
      en: row.estimated_duration_en
    },
    whatsappTemplate: {
      ar: row.whatsapp_template_ar,
      en: row.whatsapp_template_en
    },
    status: row.status,
    sortOrder: Number(row.sort_order),
    updatedAt: row.updated_at
  };
}

function contactDto(row) {
  return {
    id: row.id,
    type: row.method_type,
    iconKey: row.icon_key,
    iconUrl: row.icon_url,
    name: { ar: row.name_ar, en: row.name_en },
    description: { ar: row.description_ar, en: row.description_en },
    target: row.target,
    messageTemplate: {
      ar: row.message_template_ar,
      en: row.message_template_en
    },
    workingHours: {
      ar: row.working_hours_ar,
      en: row.working_hours_en
    },
    status: row.status,
    sortOrder: Number(row.sort_order),
    updatedAt: row.updated_at
  };
}

function paymentDto(row, instructions = [], { includePrivate = false } = {}) {
  const active = includePrivate || row.status === "active";
  const configured = Boolean(row.account_identifier || row.qr_data || row.qr_image_url);
  return {
    id: row.id,
    key: row.method_key,
    type: row.method_type,
    logoUrl: row.logo_url,
    name: { ar: row.name_ar, en: row.name_en },
    currency: row.currency,
    network: row.network,
    beneficiaryName: active ? row.beneficiary_name : null,
    accountIdentifier: active ? row.account_identifier : null,
    qrMode: active ? row.qr_mode : "none",
    qrData: includePrivate ? row.qr_data : undefined,
    qrImageUrl: active && row.qr_mode === "uploaded" ? row.qr_image_url : null,
    qrUrl:
      active && row.qr_mode === "generated" && row.qr_data
        ? `/api/public/payment-methods/${row.id}/qr.svg`
        : null,
    minimumAmountMinor:
      row.minimum_amount_minor === null || row.minimum_amount_minor === undefined
        ? null
        : Number(row.minimum_amount_minor),
    maximumAmountMinor:
      row.maximum_amount_minor === null || row.maximum_amount_minor === undefined
        ? null
        : Number(row.maximum_amount_minor),
    status: row.status,
    configured,
    sortOrder: Number(row.sort_order),
    instructions: instructions.map((instruction) => ({
      id: instruction.id,
      locale: instruction.locale,
      title: instruction.title,
      body: instruction.body,
      warning: instruction.warning,
      sortOrder: Number(instruction.sortOrder ?? instruction.sort_order ?? 0)
    }))
  };
}

function bannerDto(row) {
  return {
    id: row.id,
    title: { ar: row.title_ar, en: row.title_en },
    subtitle: { ar: row.subtitle_ar, en: row.subtitle_en },
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    actionLabel: { ar: row.action_label_ar, en: row.action_label_en },
    status: row.status,
    sortOrder: Number(row.sort_order)
  };
}

function portfolioDto(row) {
  return {
    id: row.id,
    title: { ar: row.title_ar, en: row.title_en },
    description: { ar: row.description_ar, en: row.description_en },
    imageUrl: row.image_url,
    targetUrl: row.target_url,
    type: row.item_type,
    status: row.status,
    sortOrder: Number(row.sort_order)
  };
}

async function portalSnapshot(db, { includeHidden = false } = {}) {
  const visible = includeHidden
    ? "WHERE tenant_id IS NULL AND store_id IS NULL"
    : "WHERE tenant_id IS NULL AND store_id IS NULL AND status IN ('active','coming_soon')";
  const activeContent = includeHidden
    ? "WHERE tenant_id IS NULL AND store_id IS NULL"
    : "WHERE tenant_id IS NULL AND store_id IS NULL AND status='active'";
  const [services, contacts, payments, instructionRows, banners, portfolio, settings] =
    await Promise.all([
      db.query(`SELECT * FROM platform_services ${visible} ORDER BY sort_order, created_at`),
      db.query(
        `SELECT * FROM contact_methods ${includeHidden ? "WHERE tenant_id IS NULL AND store_id IS NULL" : "WHERE tenant_id IS NULL AND store_id IS NULL AND status='active'"} ORDER BY sort_order, created_at`
      ),
      db.query(
        `SELECT * FROM platform_payment_methods ${visible} ORDER BY sort_order, created_at`
      ),
      db.query(
        `SELECT * FROM payment_method_instructions
         WHERE platform_payment_method_id IS NOT NULL
         ORDER BY platform_payment_method_id, locale, sort_order`
      ),
      db.query(`SELECT * FROM platform_banners ${activeContent} ORDER BY sort_order, created_at`),
      db.query(`SELECT * FROM portfolio_items ${activeContent} ORDER BY sort_order, created_at`),
      db.query(
        `SELECT setting_key, setting_value FROM system_settings
         WHERE scope='platform' ${includeHidden ? "" : "AND is_public=TRUE"}
         ORDER BY setting_key`
      )
    ]);
  const instructionMap = new Map();
  for (const row of instructionRows.rows) {
    if (!instructionMap.has(row.platform_payment_method_id)) {
      instructionMap.set(row.platform_payment_method_id, []);
    }
    instructionMap.get(row.platform_payment_method_id).push({
      id: row.id,
      locale: row.locale,
      title: row.title,
      body: row.body,
      warning: row.warning,
      sortOrder: Number(row.sort_order)
    });
  }
  return {
    services: services.rows.map(serviceDto),
    contacts: contacts.rows.map(contactDto),
    paymentMethods: payments.rows.map((row) =>
      paymentDto(row, instructionMap.get(row.id) || [], { includePrivate: includeHidden })
    ),
    banners: banners.rows.map(bannerDto),
    portfolio: portfolio.rows.map(portfolioDto),
    settings: Object.fromEntries(
      settings.rows.map((row) => [row.setting_key, jsonValue(row.setting_value, {})])
    )
  };
}

async function audit(db, request, user, action, entityType, entityId, beforeData, afterData) {
  await db.query(
    `INSERT INTO platform_audit_logs (
       id, actor_user_id, action, entity_type, entity_id,
       before_data, after_data, ip_address, user_agent
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      randomUUID(),
      user.id,
      action,
      entityType,
      String(entityId),
      beforeData || null,
      afterData || null,
      request.ip,
      text(request.headers["user-agent"], 500) || null
    ]
  );
}

async function platformAdmin(db, request, auth, { mutate = false } = {}) {
  const user = await auth.authenticate(db, request);
  auth.requirePlatformAdmin(user);
  if (mutate) auth.requireCsrf(request, user);
  return user;
}

function serviceValues(body, current = {}) {
  return {
    serviceKey: required(body.serviceKey ?? current.service_key, "serviceKey", 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-"),
    slug: required(body.slug ?? current.slug, "slug", 100)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-"),
    iconKey: text(body.iconKey ?? current.icon_key, 60) || "code",
    nameAr: required(body.nameAr ?? current.name_ar, "nameAr", 160),
    nameEn: required(body.nameEn ?? current.name_en, "nameEn", 160),
    descriptionAr: text(body.descriptionAr ?? current.description_ar, 2400),
    descriptionEn: text(body.descriptionEn ?? current.description_en, 2400),
    featuresAr: stringList(body.featuresAr ?? jsonValue(current.features_ar, [])),
    featuresEn: stringList(body.featuresEn ?? jsonValue(current.features_en, [])),
    startingPriceMinor: integer(body.startingPriceMinor ?? current.starting_price_minor, {
      nullable: true,
      minimum: 0
    }),
    currency: (text(body.currency ?? current.currency, 3) || "USD").toUpperCase(),
    estimatedDurationAr: text(body.estimatedDurationAr ?? current.estimated_duration_ar, 160) || null,
    estimatedDurationEn: text(body.estimatedDurationEn ?? current.estimated_duration_en, 160) || null,
    whatsappTemplateAr: text(body.whatsappTemplateAr ?? current.whatsapp_template_ar, 1200),
    whatsappTemplateEn: text(body.whatsappTemplateEn ?? current.whatsapp_template_en, 1200),
    status: status(body.status ?? current.status, SERVICE_STATUSES, "active"),
    sortOrder: integer(body.sortOrder ?? current.sort_order ?? 0, { minimum: 0, maximum: 100000 })
  };
}

function contactValues(body, current = {}) {
  const type = text(body.type ?? current.method_type, 40);
  if (!CONTACT_TYPES.has(type)) throw new PortalError(422, "invalid_contact_type", "Contact type is invalid");
  return {
    type,
    iconKey: text(body.iconKey ?? current.icon_key, 60) || type,
    iconUrl: safeAssetUrl(body.iconUrl ?? current.icon_url, "contact icon"),
    nameAr: required(body.nameAr ?? current.name_ar, "nameAr", 160),
    nameEn: required(body.nameEn ?? current.name_en, "nameEn", 160),
    descriptionAr: text(body.descriptionAr ?? current.description_ar, 1000),
    descriptionEn: text(body.descriptionEn ?? current.description_en, 1000),
    target: contactTarget(type, body.target ?? current.target),
    messageTemplateAr: text(body.messageTemplateAr ?? current.message_template_ar, 1200),
    messageTemplateEn: text(body.messageTemplateEn ?? current.message_template_en, 1200),
    workingHoursAr: text(body.workingHoursAr ?? current.working_hours_ar, 300) || null,
    workingHoursEn: text(body.workingHoursEn ?? current.working_hours_en, 300) || null,
    status: status(body.status ?? current.status, CONTACT_STATUSES, "active"),
    sortOrder: integer(body.sortOrder ?? current.sort_order ?? 0, { minimum: 0, maximum: 100000 })
  };
}

function paymentValues(body, current = {}) {
  const qrMode = status(body.qrMode ?? current.qr_mode, QR_MODES, "none");
  const qrData = text(body.qrData ?? current.qr_data, 2200) || null;
  const qrImageUrl = safeAssetUrl(body.qrImageUrl ?? current.qr_image_url, "QR image");
  if (qrMode === "generated" && !qrData) {
    throw new PortalError(422, "qr_data_required", "QR data is required for generated QR");
  }
  if (qrMode === "uploaded" && !qrImageUrl) {
    throw new PortalError(422, "qr_image_required", "QR image is required for uploaded QR");
  }
  const minimum = integer(body.minimumAmountMinor ?? current.minimum_amount_minor, {
    nullable: true,
    minimum: 0
  });
  const maximum = integer(body.maximumAmountMinor ?? current.maximum_amount_minor, {
    nullable: true,
    minimum: 0
  });
  if (minimum !== null && maximum !== null && maximum < minimum) {
    throw new PortalError(422, "invalid_payment_limits", "Maximum amount must not be below minimum amount");
  }
  return {
    key: required(body.key ?? current.method_key, "key", 80)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-"),
    type: required(body.type ?? current.method_type, "type", 80),
    logoUrl: safeAssetUrl(body.logoUrl ?? current.logo_url, "payment logo"),
    nameAr: required(body.nameAr ?? current.name_ar, "nameAr", 160),
    nameEn: required(body.nameEn ?? current.name_en, "nameEn", 160),
    currency: required(body.currency ?? current.currency, "currency", 20).toUpperCase(),
    network: text(body.network ?? current.network, 80) || null,
    beneficiaryName: text(body.beneficiaryName ?? current.beneficiary_name, 200) || null,
    accountIdentifier: text(body.accountIdentifier ?? current.account_identifier, 1200) || null,
    qrMode,
    qrData,
    qrImageUrl,
    minimum,
    maximum,
    instructions: [
      {
        locale: "ar",
        title: text(body.instructionTitleAr, 240) || null,
        body: text(body.instructionAr, 3000),
        warning: text(body.warningAr, 1200),
        titleProvided: Object.hasOwn(body, "instructionTitleAr"),
        bodyProvided: Object.hasOwn(body, "instructionAr"),
        warningProvided: Object.hasOwn(body, "warningAr")
      },
      {
        locale: "en",
        title: text(body.instructionTitleEn, 240) || null,
        body: text(body.instructionEn, 3000),
        warning: text(body.warningEn, 1200),
        titleProvided: Object.hasOwn(body, "instructionTitleEn"),
        bodyProvided: Object.hasOwn(body, "instructionEn"),
        warningProvided: Object.hasOwn(body, "warningEn")
      }
    ],
    status: status(body.status ?? current.status, PAYMENT_STATUSES, "coming_soon"),
    sortOrder: integer(body.sortOrder ?? current.sort_order ?? 0, { minimum: 0, maximum: 100000 })
  };
}

function mergedPaymentInstructions(values, existing = []) {
  return values.instructions.map((instruction) => {
    const previous = existing.find((item) => item.locale === instruction.locale);
    return {
      ...instruction,
      title: instruction.titleProvided
        ? instruction.title || (instruction.locale === "ar" ? "تعليمات التحويل" : "Transfer instructions")
        : previous?.title || (instruction.locale === "ar" ? "تعليمات التحويل" : "Transfer instructions"),
      body: instruction.bodyProvided ? instruction.body : previous?.body || "",
      warning: instruction.warningProvided ? instruction.warning : previous?.warning || ""
    };
  });
}

async function upsertPaymentInstructions(client, methodId, instructions, userId) {
  for (const instruction of instructions) {
    await client.query(
      `INSERT INTO payment_method_instructions (
         id, platform_payment_method_id, locale, title, body, warning,
         sort_order, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,0,$7,$7)
       ON CONFLICT (platform_payment_method_id, locale, sort_order) DO UPDATE SET
         title=EXCLUDED.title, body=EXCLUDED.body, warning=EXCLUDED.warning,
         updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [
        randomUUID(), methodId, instruction.locale, instruction.title,
        instruction.body, instruction.warning, userId
      ]
    );
  }
}

function providerValues(body, current = {}) {
  const adapterKey = text(body.adapterKey ?? current.adapter_key, 80) || "mock";
  if (!PROVIDER_ADAPTERS.has(adapterKey)) {
    throw new PortalError(422, "invalid_provider_adapter", "Provider adapter is not supported");
  }
  if (body.testMode !== undefined && typeof body.testMode !== "boolean") {
    throw new PortalError(422, "invalid_test_mode", "Provider test mode must be a boolean");
  }
  const testMode = body.testMode === undefined ? Boolean(current.test_mode ?? true) : body.testMode;
  const baseUrlCandidate = text(body.baseUrl ?? current.base_url, 1000);
  let baseUrl = "";
  if (baseUrlCandidate) {
    let parsed;
    try {
      parsed = new URL(baseUrlCandidate);
    } catch {
      throw new PortalError(422, "invalid_provider_url", "Provider base URL is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new PortalError(422, "invalid_provider_url", "Provider base URL must be a clean HTTPS URL");
    }
    baseUrl = parsed.toString().replace(/\/$/, "");
  }
  if (!testMode && adapterKey !== "mock" && !baseUrl) {
    throw new PortalError(422, "provider_url_required", "A live provider requires an HTTPS base URL");
  }
  const currency = (text(body.currency ?? current.currency, 10) || "USD").toUpperCase();
  if (!/^[A-Z0-9]{3,10}$/.test(currency)) {
    throw new PortalError(422, "invalid_provider_currency", "Provider currency is invalid");
  }
  return {
    internalName: required(body.internalName ?? current.internal_name, "internalName", 160),
    adapterKey,
    baseUrl,
    currency,
    testMode,
    capabilities: stringList(body.capabilities ?? jsonValue(current.capabilities, []), 24, 80),
    status: status(body.status ?? current.status, PROVIDER_STATUSES, "active"),
    primaryCredential: text(body.primaryCredential, 8000),
    webhookSecret: text(body.webhookSecret, 8000)
  };
}

async function upsertProviderCredential(client, config, providerId, key, value, userId) {
  if (!value) return;
  await client.query(
    `INSERT INTO api_provider_credentials (
       id, provider_id, credential_key, credentials_ciphertext,
       last_rotated_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,NOW(),$5,$5)
     ON CONFLICT (provider_id, credential_key) DO UPDATE SET
       credentials_ciphertext=EXCLUDED.credentials_ciphertext,
       last_rotated_at=NOW(), updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
    [randomUUID(), providerId, key, encryptSecret(value, config.encryptionKey), userId]
  );
}

function providerAuditDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    internalName: row.internal_name,
    publicAlias: row.public_alias,
    adapterKey: row.adapter_key,
    baseUrl: row.base_url,
    currency: row.currency,
    testMode: Boolean(row.test_mode),
    status: row.status,
    capabilities: jsonValue(row.capabilities, []),
    legacyCredentialConfigured: Boolean(row.credentials_ciphertext)
  };
}

function bannerValues(body, current = {}) {
  return {
    titleAr: required(body.titleAr ?? current.title_ar, "titleAr", 200),
    titleEn: required(body.titleEn ?? current.title_en, "titleEn", 200),
    subtitleAr: text(body.subtitleAr ?? current.subtitle_ar, 1000),
    subtitleEn: text(body.subtitleEn ?? current.subtitle_en, 1000),
    imageUrl: safeAssetUrl(body.imageUrl ?? current.image_url, "banner image", { nullable: false }),
    linkUrl: safeActionUrl(body.linkUrl ?? current.link_url, "banner link"),
    actionLabelAr: text(body.actionLabelAr ?? current.action_label_ar, 100),
    actionLabelEn: text(body.actionLabelEn ?? current.action_label_en, 100),
    status: status(body.status ?? current.status, CONTENT_STATUSES, "active"),
    sortOrder: integer(body.sortOrder ?? current.sort_order ?? 0, { minimum: 0, maximum: 100000 })
  };
}

function route(handler) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      if (error instanceof PortalError) throw error;
      if (error?.code === "23505") {
        throw new PortalError(409, "conflict", "A record with the same key already exists");
      }
      throw error;
    }
  };
}

export function installPortalRoutes(app, { db, config, auth }) {
  app.get("/api/public/portal", route(async () => ({
    ...(await portalSnapshot(db)),
    whatsappNumber: config.platformWhatsappNumber,
    supportedLocales: ["ar", "en"],
    defaultLocale: "ar"
  })));

  app.get(
    "/api/public/payment-methods/:methodId/qr.svg",
    route(async (request, reply) => {
      const methodId = uuid(request.params.methodId, "payment method");
      const row = (
        await db.query(
          `SELECT id, qr_mode, qr_data FROM platform_payment_methods
           WHERE id=$1 AND tenant_id IS NULL AND store_id IS NULL AND status='active'`,
          [methodId]
        )
      ).rows[0];
      if (!row || row.qr_mode !== "generated" || !row.qr_data) {
        throw new PortalError(404, "qr_not_found", "QR is not available");
      }
      const svg = await QRCode.toString(row.qr_data, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 360,
        color: { dark: "#17191f", light: "#ffffff" }
      });
      reply.header("cache-control", "private, no-store");
      reply.type("image/svg+xml; charset=utf-8");
      return svg;
    })
  );

  app.post(
    "/api/public/service-requests",
    route(async (request, reply) => {
      const body = request.body || {};
      const idempotencyKey = required(request.headers["idempotency-key"], "Idempotency-Key", 160);
      const serviceId = uuid(body.serviceId, "service");
      const service = (
        await db.query(
          `SELECT * FROM platform_services
           WHERE id=$1 AND tenant_id IS NULL AND store_id IS NULL AND status='active'`,
          [serviceId]
        )
      ).rows[0];
      if (!service) throw new PortalError(404, "service_not_found", "Service is not available");
      const locale = body.locale === "en" ? "en" : "ar";
      const customerName = required(body.customerName, "customerName", 160);
      const customerEmail = text(body.customerEmail, 240).toLowerCase() || null;
      const customerPhone = text(body.customerPhone, 40) || null;
      if (!customerEmail && !customerPhone) {
        throw new PortalError(422, "contact_required", "Email or phone is required");
      }
      if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
        throw new PortalError(422, "invalid_email", "Email address is invalid");
      }
      const details = required(body.details, "details", 6000);
      const sourcePage = safeActionUrl(body.sourcePage || "/", "source page");
      const normalized = {
        serviceId,
        customerName,
        customerEmail,
        customerPhone,
        details,
        locale,
        sourcePage
      };
      const requestHash = sha256(JSON.stringify(normalized));
      const previous = (
        await db.query(
          "SELECT id, request_hash, status, created_at FROM service_requests WHERE idempotency_key=$1",
          [idempotencyKey]
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new PortalError(409, "idempotency_mismatch", "Use a new request key for different details");
        }
        return {
          request: {
            id: previous.id,
            status: previous.status,
            createdAt: previous.created_at
          },
          duplicate: true
        };
      }
      let user = null;
      try {
        user = await auth.authenticate(db, request);
      } catch (error) {
        if (error?.statusCode !== 401) throw error;
      }
      const id = randomUUID();
      await db.query(
        `INSERT INTO service_requests (
           id, service_id, user_id, customer_name, customer_email, customer_phone,
           customer_internal_id, locale, details, source_page, idempotency_key,
           request_hash, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3)`,
        [
          id,
          serviceId,
          user?.id || null,
          customerName,
          customerEmail,
          customerPhone,
          user?.id || null,
          locale,
          details,
          sourcePage,
          idempotencyKey,
          requestHash
        ]
      );
      reply.code(201);
      return { request: { id, status: "new", createdAt: new Date().toISOString() } };
    })
  );

  app.get(
    "/api/platform/portal",
    route(async (request) => {
      await platformAdmin(db, request, auth);
      const [
        snapshot, counts, requests, providers, providerCredentials, providerOrders,
        providerCatalog, providerSyncLogs, errors, auditRows
      ] = await Promise.all([
        portalSnapshot(db, { includeHidden: true }),
        db.query(
          `SELECT
             (SELECT COUNT(*) FROM platform_users) AS users,
             (SELECT COUNT(*) FROM stores) AS stores,
             (SELECT COUNT(*) FROM subscriptions WHERE status IN ('trial','active')) AS subscriptions,
             (SELECT COUNT(*) FROM service_requests WHERE status NOT IN ('completed','cancelled','rejected')) AS open_service_requests,
             (SELECT COUNT(*) FROM provider_orders WHERE status IN ('pending','submitted','processing','requires_review')) AS open_provider_orders`
        ),
        db.query(
          `SELECT sr.id, sr.customer_name, sr.customer_email, sr.customer_phone,
                  sr.locale, sr.details, sr.source_page, sr.status, sr.created_at,
                  ps.name_ar AS service_name_ar, ps.name_en AS service_name_en
           FROM service_requests sr
           JOIN platform_services ps ON ps.id=sr.service_id
           ORDER BY sr.created_at DESC LIMIT 100`
        ),
        db.query(
          `SELECT p.id, p.internal_name, p.public_alias, p.adapter_key, p.base_url,
                  p.currency, p.test_mode, p.connection_status, p.balance_minor,
                  p.last_checked_at, p.status, p.capabilities,
                  p.credentials_ciphertext IS NOT NULL AS has_legacy_credential
           FROM api_providers p ORDER BY p.public_alias`
        ),
        db.query(
          `SELECT provider_id, credential_key FROM api_provider_credentials
           WHERE credential_key IN ('primary','webhook')`
        ),
        db.query(
          `SELECT po.id, po.status, po.external_order_id, po.attempt_count,
                  po.next_attempt_at, po.next_status_check_at, po.created_at,
                  p.public_alias, o.order_number, s.name AS store_name
           FROM provider_orders po
           JOIN api_providers p ON p.id=po.provider_id
           JOIN orders o ON o.id=po.order_id
           JOIN stores s ON s.id=po.store_id
           ORDER BY po.created_at DESC LIMIT 100`
        ),
        db.query(
          `SELECT s.id, s.public_name, s.provider_status, s.original_cost_minor,
                  s.currency, s.minimum_quantity, s.maximum_quantity,
                  c.public_name AS category_name, p.public_alias
           FROM api_services s
           JOIN api_providers p ON p.id=s.provider_id
           LEFT JOIN api_categories c ON c.id=s.api_category_id
           ORDER BY p.public_alias, c.public_name, s.public_name LIMIT 250`
        ),
        db.query(
          `SELECT l.id, l.provider_id, l.status, l.categories_count,
                  l.services_count, l.error_message, l.started_at, l.finished_at,
                  p.public_alias
           FROM provider_sync_logs l JOIN api_providers p ON p.id=l.provider_id
           ORDER BY l.started_at DESC LIMIT 100`
        ),
        db.query(
          `SELECT id, provider_id, provider_order_id, error_code, error_category,
                  safe_message, retryable, retry_count, next_retry_at, resolved_at, created_at
           FROM provider_errors ORDER BY created_at DESC LIMIT 100`
        ),
        db.query(
          `SELECT id, actor_user_id, action, entity_type, entity_id, created_at
           FROM platform_audit_logs ORDER BY created_at DESC LIMIT 100`
        )
      ]);
      return {
        ...snapshot,
        counts: {
          users: Number(counts.rows[0]?.users || 0),
          stores: Number(counts.rows[0]?.stores || 0),
          subscriptions: Number(counts.rows[0]?.subscriptions || 0),
          openServiceRequests: Number(counts.rows[0]?.open_service_requests || 0),
          openProviderOrders: Number(counts.rows[0]?.open_provider_orders || 0)
        },
        serviceRequests: requests.rows.map((row) => ({
          id: row.id,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          customerPhone: row.customer_phone,
          locale: row.locale,
          details: row.details,
          sourcePage: row.source_page,
          status: row.status,
          createdAt: row.created_at,
          serviceName: { ar: row.service_name_ar, en: row.service_name_en }
        })),
        providers: providers.rows.map((row) => {
          const credentialKeys = providerCredentials.rows
            .filter((credential) => credential.provider_id === row.id)
            .map((credential) => credential.credential_key);
          return {
            id: row.id,
            alias: row.public_alias,
            internalName: row.internal_name,
            adapterKey: row.adapter_key,
            baseUrl: row.base_url,
            currency: row.currency,
            testMode: Boolean(row.test_mode),
            connectionStatus: row.connection_status,
            balanceMinor: row.balance_minor === null ? null : Number(row.balance_minor),
            lastCheckedAt: row.last_checked_at,
            status: row.status,
            capabilities: jsonValue(row.capabilities, []),
            hasPrimaryCredential:
              Boolean(row.has_legacy_credential) || credentialKeys.includes("primary"),
            hasWebhookSecret: credentialKeys.includes("webhook"),
            webhookUrl: `/webhooks/providers/${row.id}`
          };
        }),
        providerOrders: providerOrders.rows.map((row) => ({
          id: row.id,
          status: row.status,
          externalOrderId: row.external_order_id,
          attemptCount: Number(row.attempt_count || 0),
          nextAttemptAt: row.next_attempt_at,
          nextStatusCheckAt: row.next_status_check_at,
          createdAt: row.created_at,
          providerAlias: row.public_alias,
          orderNumber: row.order_number,
          storeName: row.store_name
        })),
        providerCatalog: providerCatalog.rows.map((row) => ({
          id: row.id,
          name: row.public_name,
          categoryName: row.category_name,
          providerAlias: row.public_alias,
          status: row.provider_status,
          costMinor: Number(row.original_cost_minor || 0),
          currency: row.currency,
          minimumQuantity: Number(row.minimum_quantity || 1),
          maximumQuantity:
            row.maximum_quantity === null ? null : Number(row.maximum_quantity)
        })),
        providerSyncLogs: providerSyncLogs.rows.map((row) => ({
          id: row.id,
          providerId: row.provider_id,
          providerAlias: row.public_alias,
          status: row.status,
          categoriesCount: Number(row.categories_count || 0),
          servicesCount: Number(row.services_count || 0),
          errorMessage: row.error_message,
          startedAt: row.started_at,
          finishedAt: row.finished_at
        })),
        providerErrors: errors.rows,
        auditLogs: auditRows.rows
      };
    })
  );

  app.post(
    "/api/platform/providers",
    route(async (request, reply) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const values = providerValues(request.body || {});
      const aliases = (
        await db.query("SELECT public_alias FROM api_providers ORDER BY public_alias")
      ).rows.map((row) => row.public_alias);
      const usedSlots = new Set(
        aliases
          .map((alias) => /^UCHIHA API (\d+)$/.exec(alias)?.[1])
          .filter(Boolean)
          .map(Number)
      );
      let slot = 1;
      while (usedSlots.has(slot)) slot += 1;
      const id = randomUUID();
      const publicAlias = `UCHIHA API ${slot}`;
      const row = await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO api_providers (
             id, internal_name, public_alias, adapter_key, base_url, currency,
             test_mode, connection_status, capabilities, status, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,'not_configured',$8,$9,$10,$10)`,
          [
            id, values.internalName, publicAlias, values.adapterKey, values.baseUrl,
            values.currency, values.testMode, JSON.stringify(values.capabilities),
            values.status, user.id
          ]
        );
        await upsertProviderCredential(client, config, id, "primary", values.primaryCredential, user.id);
        await upsertProviderCredential(client, config, id, "webhook", values.webhookSecret, user.id);
        return (await client.query("SELECT * FROM api_providers WHERE id=$1", [id])).rows[0];
      });
      await audit(
        db, request, user, "platform.provider_created", "api_provider", id,
        null, providerAuditDto(row)
      );
      reply.code(201);
      return {
        provider: {
          ...providerAuditDto(row),
          alias: row.public_alias,
          hasPrimaryCredential: Boolean(values.primaryCredential),
          hasWebhookSecret: Boolean(values.webhookSecret),
          webhookUrl: `/webhooks/providers/${id}`
        }
      };
    })
  );

  app.put(
    "/api/platform/providers/:providerId",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.providerId, "provider");
      const current = (await db.query("SELECT * FROM api_providers WHERE id=$1", [id])).rows[0];
      if (!current) throw new PortalError(404, "provider_not_found", "Provider was not found");
      const values = providerValues(request.body || {}, current);
      const row = await db.transaction(async (client) => {
        await client.query(
          `UPDATE api_providers SET
             internal_name=$2, adapter_key=$3, base_url=$4, currency=$5,
             test_mode=$6, capabilities=$7, status=$8,
             connection_status=CASE
               WHEN adapter_key<>$3 OR base_url<>$4 OR test_mode<>$6 THEN 'not_configured'
               ELSE connection_status
             END,
             updated_by=$9, updated_at=NOW()
           WHERE id=$1`,
          [
            id, values.internalName, values.adapterKey, values.baseUrl,
            values.currency, values.testMode, JSON.stringify(values.capabilities),
            values.status, user.id
          ]
        );
        await upsertProviderCredential(client, config, id, "primary", values.primaryCredential, user.id);
        await upsertProviderCredential(client, config, id, "webhook", values.webhookSecret, user.id);
        if (values.primaryCredential) {
          await client.query(
            "UPDATE api_providers SET connection_status='not_configured', updated_at=NOW() WHERE id=$1",
            [id]
          );
        }
        return (await client.query("SELECT * FROM api_providers WHERE id=$1", [id])).rows[0];
      });
      await audit(
        db, request, user, "platform.provider_updated", "api_provider", id,
        providerAuditDto(current), providerAuditDto(row)
      );
      const credentialFlags = (
        await db.query(
          `SELECT credential_key FROM api_provider_credentials
           WHERE provider_id=$1 AND credential_key IN ('primary','webhook')`,
          [id]
        )
      ).rows.map((item) => item.credential_key);
      return {
        provider: {
          ...providerAuditDto(row),
          alias: row.public_alias,
          hasPrimaryCredential:
            Boolean(row.credentials_ciphertext) || credentialFlags.includes("primary"),
          hasWebhookSecret: credentialFlags.includes("webhook"),
          webhookUrl: `/webhooks/providers/${id}`
        }
      };
    })
  );

  app.post(
    "/api/platform/services",
    route(async (request, reply) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const values = serviceValues(request.body || {});
      const id = randomUUID();
      await db.query(
        `INSERT INTO platform_services (
           id, service_key, slug, icon_key, name_ar, name_en,
           description_ar, description_en, features_ar, features_en,
           starting_price_minor, currency, estimated_duration_ar, estimated_duration_en,
           whatsapp_template_ar, whatsapp_template_en, status, sort_order,
           created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
        [
          id, values.serviceKey, values.slug, values.iconKey, values.nameAr, values.nameEn,
          values.descriptionAr, values.descriptionEn, JSON.stringify(values.featuresAr), JSON.stringify(values.featuresEn),
          values.startingPriceMinor, values.currency, values.estimatedDurationAr,
          values.estimatedDurationEn, values.whatsappTemplateAr, values.whatsappTemplateEn,
          values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM platform_services WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.service_created", "platform_service", id, null, row);
      reply.code(201);
      return { service: serviceDto(row) };
    })
  );

  app.put(
    "/api/platform/services/:serviceId",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.serviceId, "service");
      const current = (await db.query("SELECT * FROM platform_services WHERE id=$1", [id])).rows[0];
      if (!current) throw new PortalError(404, "service_not_found", "Service was not found");
      const values = serviceValues(request.body || {}, current);
      await db.query(
        `UPDATE platform_services SET
           service_key=$2, slug=$3, icon_key=$4, name_ar=$5, name_en=$6,
           description_ar=$7, description_en=$8, features_ar=$9, features_en=$10,
           starting_price_minor=$11, currency=$12, estimated_duration_ar=$13,
           estimated_duration_en=$14, whatsapp_template_ar=$15,
           whatsapp_template_en=$16, status=$17, sort_order=$18,
           updated_by=$19, updated_at=NOW()
         WHERE id=$1`,
        [
          id, values.serviceKey, values.slug, values.iconKey, values.nameAr, values.nameEn,
          values.descriptionAr, values.descriptionEn, JSON.stringify(values.featuresAr), JSON.stringify(values.featuresEn),
          values.startingPriceMinor, values.currency, values.estimatedDurationAr,
          values.estimatedDurationEn, values.whatsappTemplateAr, values.whatsappTemplateEn,
          values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM platform_services WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.service_updated", "platform_service", id, current, row);
      return { service: serviceDto(row) };
    })
  );

  app.post(
    "/api/platform/contact-methods",
    route(async (request, reply) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const values = contactValues(request.body || {});
      const id = randomUUID();
      await db.query(
        `INSERT INTO contact_methods (
           id, method_type, icon_key, icon_url, name_ar, name_en,
           description_ar, description_en, target, message_template_ar,
           message_template_en, working_hours_ar, working_hours_en,
           status, sort_order, created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
        [
          id, values.type, values.iconKey, values.iconUrl, values.nameAr, values.nameEn,
          values.descriptionAr, values.descriptionEn, values.target,
          values.messageTemplateAr, values.messageTemplateEn, values.workingHoursAr,
          values.workingHoursEn, values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM contact_methods WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.contact_created", "contact_method", id, null, row);
      reply.code(201);
      return { contact: contactDto(row) };
    })
  );

  app.put(
    "/api/platform/contact-methods/:contactId",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.contactId, "contact");
      const current = (await db.query("SELECT * FROM contact_methods WHERE id=$1", [id])).rows[0];
      if (!current) throw new PortalError(404, "contact_not_found", "Contact method was not found");
      const values = contactValues(request.body || {}, current);
      await db.query(
        `UPDATE contact_methods SET
           method_type=$2, icon_key=$3, icon_url=$4, name_ar=$5, name_en=$6,
           description_ar=$7, description_en=$8, target=$9,
           message_template_ar=$10, message_template_en=$11,
           working_hours_ar=$12, working_hours_en=$13, status=$14,
           sort_order=$15, updated_by=$16, updated_at=NOW()
         WHERE id=$1`,
        [
          id, values.type, values.iconKey, values.iconUrl, values.nameAr, values.nameEn,
          values.descriptionAr, values.descriptionEn, values.target,
          values.messageTemplateAr, values.messageTemplateEn, values.workingHoursAr,
          values.workingHoursEn, values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM contact_methods WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.contact_updated", "contact_method", id, current, row);
      return { contact: contactDto(row) };
    })
  );

  app.post(
    "/api/platform/payment-methods",
    route(async (request, reply) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const values = paymentValues(request.body || {});
      const id = randomUUID();
      const instructions = mergedPaymentInstructions(values);
      const row = await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO platform_payment_methods (
             id, method_key, method_type, logo_url, name_ar, name_en, currency,
             network, beneficiary_name, account_identifier, qr_mode, qr_data,
             qr_image_url, minimum_amount_minor, maximum_amount_minor,
             status, sort_order, created_by, updated_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
          [
            id, values.key, values.type, values.logoUrl, values.nameAr, values.nameEn,
            values.currency, values.network, values.beneficiaryName, values.accountIdentifier,
            values.qrMode, values.qrData, values.qrImageUrl, values.minimum, values.maximum,
            values.status, values.sortOrder, user.id
          ]
        );
        await upsertPaymentInstructions(client, id, instructions, user.id);
        return (await client.query("SELECT * FROM platform_payment_methods WHERE id=$1", [id])).rows[0];
      });
      await audit(db, request, user, "platform.payment_created", "platform_payment_method", id, null, {
        ...row,
        account_identifier: row.account_identifier ? "<configured>" : null,
        qr_data: row.qr_data ? "<configured>" : null
      });
      reply.code(201);
      return { paymentMethod: paymentDto(row, instructions, { includePrivate: true }) };
    })
  );

  app.put(
    "/api/platform/payment-methods/:methodId",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.methodId, "payment method");
      const current = (
        await db.query("SELECT * FROM platform_payment_methods WHERE id=$1", [id])
      ).rows[0];
      if (!current) throw new PortalError(404, "payment_method_not_found", "Payment method was not found");
      const existingInstructions = (
        await db.query(
          `SELECT locale, title, body, warning, sort_order AS "sortOrder"
           FROM payment_method_instructions
           WHERE platform_payment_method_id=$1 ORDER BY locale, sort_order`,
          [id]
        )
      ).rows;
      const values = paymentValues(request.body || {}, current);
      const instructions = mergedPaymentInstructions(values, existingInstructions);
      const row = await db.transaction(async (client) => {
        await client.query(
          `UPDATE platform_payment_methods SET
             method_key=$2, method_type=$3, logo_url=$4, name_ar=$5, name_en=$6,
             currency=$7, network=$8, beneficiary_name=$9, account_identifier=$10,
             qr_mode=$11, qr_data=$12, qr_image_url=$13, minimum_amount_minor=$14,
             maximum_amount_minor=$15, status=$16, sort_order=$17,
             updated_by=$18, updated_at=NOW()
           WHERE id=$1`,
          [
            id, values.key, values.type, values.logoUrl, values.nameAr, values.nameEn,
            values.currency, values.network, values.beneficiaryName, values.accountIdentifier,
            values.qrMode, values.qrData, values.qrImageUrl, values.minimum, values.maximum,
            values.status, values.sortOrder, user.id
          ]
        );
        await upsertPaymentInstructions(client, id, instructions, user.id);
        return (await client.query("SELECT * FROM platform_payment_methods WHERE id=$1", [id])).rows[0];
      });
      await audit(db, request, user, "platform.payment_updated", "platform_payment_method", id, {
        ...current,
        account_identifier: current.account_identifier ? "<configured>" : null,
        qr_data: current.qr_data ? "<configured>" : null
      }, {
        ...row,
        account_identifier: row.account_identifier ? "<configured>" : null,
        qr_data: row.qr_data ? "<configured>" : null
      });
      return { paymentMethod: paymentDto(row, instructions, { includePrivate: true }) };
    })
  );

  app.post(
    "/api/platform/banners",
    route(async (request, reply) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const values = bannerValues(request.body || {});
      const id = randomUUID();
      await db.query(
        `INSERT INTO platform_banners (
           id, title_ar, title_en, subtitle_ar, subtitle_en, image_url,
           link_url, action_label_ar, action_label_en, status, sort_order,
           created_by, updated_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [
          id, values.titleAr, values.titleEn, values.subtitleAr, values.subtitleEn,
          values.imageUrl, values.linkUrl, values.actionLabelAr, values.actionLabelEn,
          values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM platform_banners WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.banner_created", "platform_banner", id, null, row);
      reply.code(201);
      return { banner: bannerDto(row) };
    })
  );

  app.put(
    "/api/platform/banners/:bannerId",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.bannerId, "banner");
      const current = (await db.query("SELECT * FROM platform_banners WHERE id=$1", [id])).rows[0];
      if (!current) throw new PortalError(404, "banner_not_found", "Banner was not found");
      const values = bannerValues(request.body || {}, current);
      await db.query(
        `UPDATE platform_banners SET
           title_ar=$2, title_en=$3, subtitle_ar=$4, subtitle_en=$5,
           image_url=$6, link_url=$7, action_label_ar=$8, action_label_en=$9,
           status=$10, sort_order=$11, updated_by=$12, updated_at=NOW()
         WHERE id=$1`,
        [
          id, values.titleAr, values.titleEn, values.subtitleAr, values.subtitleEn,
          values.imageUrl, values.linkUrl, values.actionLabelAr, values.actionLabelEn,
          values.status, values.sortOrder, user.id
        ]
      );
      const row = (await db.query("SELECT * FROM platform_banners WHERE id=$1", [id])).rows[0];
      await audit(db, request, user, "platform.banner_updated", "platform_banner", id, current, row);
      return { banner: bannerDto(row) };
    })
  );

  app.put(
    "/api/platform/service-requests/:requestId/status",
    route(async (request) => {
      const user = await platformAdmin(db, request, auth, { mutate: true });
      const id = uuid(request.params.requestId, "service request");
      const nextStatus = status(request.body?.status, REQUEST_STATUSES, "new");
      const current = (await db.query("SELECT * FROM service_requests WHERE id=$1", [id])).rows[0];
      if (!current) throw new PortalError(404, "service_request_not_found", "Service request was not found");
      await db.query(
        "UPDATE service_requests SET status=$2, updated_by=$3, updated_at=NOW() WHERE id=$1",
        [id, nextStatus, user.id]
      );
      await audit(
        db,
        request,
        user,
        "platform.service_request_status_updated",
        "service_request",
        id,
        { status: current.status },
        { status: nextStatus }
      );
      return { request: { id, status: nextStatus } };
    })
  );
}

export { PortalError, portalSnapshot };
