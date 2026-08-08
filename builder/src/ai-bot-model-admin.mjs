import { randomUUID } from "node:crypto";
import { sha256 } from "./security.mjs";

const SESSION_COOKIE = "uchiha_builder_session";
const PROTECTED_SLUGS = new Set(["uchiha-v1", "uchiha-v2"]);

class ModelAdminError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function clean(value, max = 120) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
}

async function authenticate(db, request) {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw new ModelAdminError(401, "authentication_required", "يجب تسجيل الدخول");
  const row = (
    await db.query(
      `SELECT u.*, s.csrf_hash
       FROM sessions s JOIN platform_users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.revoked_at IS NULL
         AND s.expires_at>NOW() AND u.status='active'`,
      [sha256(token)]
    )
  ).rows[0];
  if (!row) throw new ModelAdminError(401, "invalid_session", "انتهت الجلسة أو ألغيت");
  return row;
}

function requireCsrf(request, user) {
  const token = request.headers["x-csrf-token"];
  if (!token || sha256(token) !== user.csrf_hash) {
    throw new ModelAdminError(403, "csrf_failed", "تعذر التحقق من الطلب");
  }
}

async function requireInstance(db, userId, instanceId) {
  const row = (
    await db.query("SELECT * FROM ai_bot_instances WHERE id=$1 AND user_id=$2", [instanceId, userId])
  ).rows[0];
  if (!row) throw new ModelAdminError(404, "ai_bot_not_found", "بوت الذكاء الاصطناعي غير موجود");
  return row;
}

function dto(row) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    accessLevel: row.access_level,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
    intelligenceLabel: row.intelligence_label,
    analysisLabel: row.analysis_label,
    imageQualityLabel: row.image_quality_label,
    codingLabel: row.coding_label,
    educationLabel: row.education_label,
    maxOutputTokens: Number(row.max_output_tokens || 1200),
    imageEnabled: Boolean(row.image_enabled),
    protected: PROTECTED_SLUGS.has(row.slug)
  };
}

export function installAiBotModelAdminRoutes(app, { db }) {
  app.post("/api/platform/ai-bots/:instanceId/models", async (request, reply) => {
    const user = await authenticate(db, request);
    requireCsrf(request, user);
    const instance = await requireInstance(db, user.id, request.params.instanceId);
    const displayName = clean(request.body?.displayName, 120);
    if (!displayName) throw new ModelAdminError(422, "model_name_required", "اكتب اسم النموذج");
    const accessLevel = clean(request.body?.accessLevel, 10) || "pro";
    if (!["free", "pro"].includes(accessLevel)) {
      throw new ModelAdminError(422, "invalid_access", "نوع الوصول غير صالح");
    }
    const baseSlug = clean(request.body?.baseSlug, 80) || (accessLevel === "pro" ? "uchiha-v2" : "uchiha-v1");
    const count = Number((await db.query(
      "SELECT COUNT(*)::int AS count FROM ai_bot_model_profiles WHERE instance_id=$1",
      [instance.id]
    )).rows[0]?.count || 0);
    if (count >= 12) throw new ModelAdminError(409, "model_limit_reached", "الحد الأقصى هو 12 نموذجًا لكل بوت");
    const base = (
      await db.query(
        "SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2",
        [instance.id, baseSlug]
      )
    ).rows[0];
    if (!base) throw new ModelAdminError(404, "base_model_not_found", "النموذج الأساسي غير موجود");
    const slug = `custom-${randomUUID().slice(0, 12)}`;
    const id = randomUUID();
    const sortOrder = Number((await db.query(
      "SELECT COALESCE(MAX(sort_order),0)::int AS max FROM ai_bot_model_profiles WHERE instance_id=$1",
      [instance.id]
    )).rows[0]?.max || 0) + 10;
    const inserted = (
      await db.query(
        `INSERT INTO ai_bot_model_profiles (
           id, instance_id, slug, display_name, provider_model, access_level,
           enabled, sort_order, intelligence_label, analysis_label,
           image_quality_label, coding_label, education_label, max_output_tokens,
           reasoning_effort, image_enabled, image_model, image_quality, system_prompt
         ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          id, instance.id, slug, displayName, base.provider_model, accessLevel,
          sortOrder,
          clean(request.body?.intelligenceLabel, 120) || base.intelligence_label,
          clean(request.body?.analysisLabel, 120) || base.analysis_label,
          clean(request.body?.imageQualityLabel, 120) || base.image_quality_label,
          clean(request.body?.codingLabel, 120) || base.coding_label,
          clean(request.body?.educationLabel, 120) || base.education_label,
          Number(base.max_output_tokens || 1200), base.reasoning_effort,
          Boolean(base.image_enabled), base.image_model, base.image_quality, base.system_prompt
        ]
      )
    ).rows[0];
    reply.code(201);
    return { model: dto(inserted) };
  });

  app.delete("/api/platform/ai-bots/:instanceId/models/:slug", async (request) => {
    const user = await authenticate(db, request);
    requireCsrf(request, user);
    const instance = await requireInstance(db, user.id, request.params.instanceId);
    const slug = clean(request.params.slug, 80);
    if (PROTECTED_SLUGS.has(slug)) {
      throw new ModelAdminError(409, "protected_model", "يمكن تعديل V1 وV2 أو إخفاؤهما، لكن لا يمكن حذفهما");
    }
    const target = (
      await db.query("SELECT * FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [instance.id, slug])
    ).rows[0];
    if (!target) throw new ModelAdminError(404, "model_not_found", "النموذج غير موجود");
    const fallback = (
      await db.query(
        `SELECT slug FROM ai_bot_model_profiles
         WHERE instance_id=$1 AND enabled=TRUE AND access_level='free' AND slug<>$2
         ORDER BY sort_order, created_at LIMIT 1`,
        [instance.id, slug]
      )
    ).rows[0];
    if (!fallback) {
      throw new ModelAdminError(409, "free_model_required", "يجب أن يبقى نموذج مجاني واحد على الأقل قبل حذف هذا النموذج");
    }
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE ai_bot_end_users SET active_model_slug=$3, active_mode='general', previous_response_id=NULL
         WHERE instance_id=$1 AND active_model_slug=$2`,
        [instance.id, slug, fallback.slug]
      );
      await client.query("DELETE FROM ai_bot_model_profiles WHERE instance_id=$1 AND slug=$2", [instance.id, slug]);
    });
    return { deleted: true, fallbackSlug: fallback.slug };
  });
}