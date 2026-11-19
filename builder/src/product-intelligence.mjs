const ANALYZER_VERSION = "rules-2026-07-28.1";
const AUTO_APPLY_THRESHOLD = 0.72;
const FIELD_TYPES = new Set(["text", "textarea", "email", "url", "number", "tel"]);

function text(value) {
  return String(value ?? "").trim();
}

function normalizedSearch(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[_-]+/g, " ");
}

function keyName(value, fallback = "field") {
  const normalized = normalizedSearch(value)
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeChoices(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const rawValue = typeof item === "object" && item !== null
      ? item.value ?? item.id ?? item.label ?? item.name
      : item;
    const rawLabel = typeof item === "object" && item !== null
      ? item.label ?? item.name ?? rawValue
      : rawValue;
    const choiceValue = text(rawValue).slice(0, 160);
    if (!choiceValue || seen.has(choiceValue)) continue;
    seen.add(choiceValue);
    result.push({ value: choiceValue, label: text(rawLabel).slice(0, 160) || choiceValue });
  }
  return result;
}

function normalizeField(input, index = 0) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const key = keyName(input.key || input.name, `field_${index + 1}`);
  const type = FIELD_TYPES.has(text(input.type).toLowerCase()) ? text(input.type).toLowerCase() : "text";
  const choices = normalizeChoices(input.options || input.choices || input.values);
  const field = {
    key,
    label: text(input.label || input.title || input.name || key).slice(0, 120) || key,
    type: choices.length ? "text" : type,
    required: Boolean(input.required),
    maxLength: Math.max(1, Math.min(Number.parseInt(input.maxLength ?? input.max_length ?? (type === "textarea" ? 2000 : 500), 10) || 500, 2000))
  };
  if (choices.length) field.options = choices;
  if (input.minimum !== undefined && Number.isFinite(Number(input.minimum))) field.minimum = Number(input.minimum);
  if (input.maximum !== undefined && Number.isFinite(Number(input.maximum))) field.maximum = Number(input.maximum);
  if (text(input.placeholder)) field.placeholder = text(input.placeholder).slice(0, 160);
  if (text(input.inputMode)) field.inputMode = text(input.inputMode).slice(0, 30);
  return field;
}

function normalizeFields(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const keys = new Set();
  value.forEach((item, index) => {
    const field = normalizeField(item, index);
    if (!field || keys.has(field.key)) return;
    keys.add(field.key);
    result.push(field);
  });
  return result;
}

function normalizeOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item !== null && item !== undefined)
    .slice(0, 100)
    .map((item) => {
      if (typeof item !== "object" || Array.isArray(item)) return text(item).slice(0, 200);
      const clean = {};
      for (const [key, raw] of Object.entries(item)) {
        if (!["id", "key", "name", "label", "value", "price", "priceMinor", "externalId"].includes(key)) continue;
        if (["price", "priceMinor"].includes(key) && Number.isFinite(Number(raw))) clean[key] = Number(raw);
        else clean[key] = text(raw).slice(0, 200);
      }
      return clean;
    });
}

function field(key, label, type = "text", required = true, extra = {}) {
  return normalizeField({ key, label, type, required, ...extra });
}

function mergeFields(...groups) {
  const result = [];
  const keys = new Set();
  for (const group of groups) {
    for (const item of group || []) {
      if (!item || keys.has(item.key)) continue;
      keys.add(item.key);
      result.push(item);
    }
  }
  return result;
}

function hasAny(searchable, patterns) {
  return patterns.some((pattern) => pattern.test(searchable));
}

export function analyzeProductInputSchema(product = {}) {
  const existingFields = normalizeFields(product.fields);
  const existingOptions = normalizeOptions(product.options);
  const productType = text(product.productType || product.product_type || product.type).toLowerCase();
  const searchable = normalizedSearch(`${product.name || ""} ${product.description || ""} ${productType}`);
  const signals = [];
  let detectedKind = "generic";
  let inferredFields = [];
  let confidence = 0.35;

  if (existingFields.length) {
    signals.push("existing_fields");
    confidence = 0.98;
  }
  if (existingOptions.length) signals.push("existing_options");

  const game = productType === "game_topup" || hasAny(searchable, [/شحن.*لعب/, /game/, /pubg|ببجي/, /free fire|فري فاير/, /player\s*id/, /معرف.*لاعب/]);
  const mobile = hasAny(searchable, [/شحن.*هاتف/, /رصيد.*هاتف/, /mobile.*topup/, /phone.*credit/, /اتصالات|سيريتل|mtn|vodafone|orange|zain/]);
  const social = hasAny(searchable, [/انستغرام|instagram|تيك ?توك|tiktok|يوتيوب|youtube|فيس ?بوك|facebook|متابع|مشاهد|اعجاب|social/]);
  const programming = productType === "programming_service" || hasAny(searchable, [/برمج|تطوير|موقع|تطبيق|واجهة|api|بوت/]);
  const subscription = productType === "subscription" || hasAny(searchable, [/اشتراك|subscription|netflix|spotify|canva|خطة|plan/]);
  const account = productType === "account" || hasAny(searchable, [/حساب|account/]);
  const codeProduct = productType === "code" || hasAny(searchable, [/كود|code|gift card|بطاقه.*رقمي/]);

  if (game) {
    detectedKind = "game_topup";
    signals.push("game_topup_rule");
    confidence = Math.max(confidence, productType === "game_topup" ? 0.9 : 0.78);
    inferredFields.push(field("player_id", "معرّف اللاعب", "text", true, { maxLength: 120 }));
    if (hasAny(searchable, [/server|سيرفر|region|منطقه/])) {
      inferredFields.push(field("server", "السيرفر أو المنطقة", "text", true, { maxLength: 100 }));
      signals.push("server_keyword");
    }
  } else if (mobile) {
    detectedKind = "mobile_topup";
    signals.push("mobile_topup_rule");
    confidence = Math.max(confidence, 0.82);
    inferredFields.push(field("phone", "رقم الهاتف", "tel", true, { maxLength: 30, inputMode: "tel" }));
    if (hasAny(searchable, [/شركه|operator|network|اتصالات|سيريتل|mtn|vodafone|orange|zain/])) {
      inferredFields.push(field("operator", "شركة الاتصالات", "text", true, { maxLength: 80 }));
    }
  } else if (social) {
    detectedKind = "social_service";
    signals.push("social_service_rule");
    confidence = Math.max(confidence, 0.8);
    if (hasAny(searchable, [/رابط|link|url|مشاهد|اعجاب/])) {
      inferredFields.push(field("target_url", "رابط الحساب أو المنشور", "url", true, { maxLength: 1000 }));
    } else {
      inferredFields.push(field("username", "اسم المستخدم", "text", true, { maxLength: 160 }));
    }
  } else if (programming) {
    detectedKind = "programming_service";
    signals.push("programming_service_rule");
    confidence = Math.max(confidence, productType === "programming_service" ? 0.92 : 0.76);
    inferredFields.push(field("requirements", "وصف الطلب والمتطلبات", "textarea", true, { maxLength: 2000 }));
    inferredFields.push(field("reference_files_url", "رابط الملفات المرجعية", "url", false, { maxLength: 1000 }));
    inferredFields.push(field("notes", "ملاحظات إضافية", "textarea", false, { maxLength: 1200 }));
  } else if (subscription) {
    detectedKind = "subscription";
    signals.push("subscription_rule");
    confidence = Math.max(confidence, productType === "subscription" ? 0.87 : 0.73);
    inferredFields.push(field("email", "البريد الإلكتروني للحساب", "email", true, { maxLength: 200 }));
    if (hasAny(searchable, [/خطة|plan|نوع.*اشتراك/])) inferredFields.push(field("plan", "نوع الخطة", "text", true, { maxLength: 100 }));
    if (hasAny(searchable, [/مده|مدة|duration|شهر|سنه|سنة/])) inferredFields.push(field("duration", "المدة", "text", true, { maxLength: 80 }));
  } else if (account) {
    detectedKind = "account";
    signals.push("account_rule");
    confidence = Math.max(confidence, productType === "account" ? 0.78 : 0.68);
    inferredFields.push(field("contact_email", "البريد الإلكتروني للاستلام", "email", true, { maxLength: 200 }));
  } else if (codeProduct || productType === "digital") {
    detectedKind = codeProduct ? "code" : "digital_delivery";
    signals.push(codeProduct ? "code_delivery_rule" : "digital_delivery_rule");
    confidence = Math.max(confidence, codeProduct ? 0.88 : 0.74);
  } else if (productType === "api_service") {
    detectedKind = "api_service";
    signals.push("api_service_rule");
    confidence = Math.max(confidence, 0.76);
    inferredFields.push(field("request_details", "تفاصيل الطلب", "textarea", true, { maxLength: 2000 }));
  } else if (productType === "service") {
    detectedKind = "service";
    signals.push("generic_service_rule");
    confidence = Math.max(confidence, 0.58);
    inferredFields.push(field("request_details", "تفاصيل الطلب", "textarea", true, { maxLength: 2000 }));
  }

  const fields = mergeFields(existingFields, inferredFields);
  if (existingFields.length && inferredFields.some((item) => !existingFields.some((existing) => existing.key === item.key))) {
    signals.push("fields_augmented");
    confidence = Math.min(confidence, 0.9);
  }
  const roundedConfidence = Math.round(Math.max(0, Math.min(confidence, 1)) * 100) / 100;
  const status = roundedConfidence >= AUTO_APPLY_THRESHOLD ? "auto_applied" : "review_required";
  return {
    analyzerVersion: ANALYZER_VERSION,
    detectedKind,
    confidence: roundedConfidence,
    status,
    fields,
    options: existingOptions,
    signals: [...new Set(signals)],
    autoApply: status === "auto_applied"
  };
}

export function normalizeReviewedSchema({ fields, options }) {
  const normalizedFields = normalizeFields(fields);
  const normalizedOptions = normalizeOptions(options);
  if (normalizedFields.length > 30) throw new Error("too_many_fields");
  return { fields: normalizedFields, options: normalizedOptions };
}

export const PRODUCT_ANALYZER_VERSION = ANALYZER_VERSION;
export const PRODUCT_AUTO_APPLY_THRESHOLD = AUTO_APPLY_THRESHOLD;
