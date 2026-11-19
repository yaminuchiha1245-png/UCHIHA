import { randomUUID, timingSafeEqual } from "node:crypto";
import { decryptSecret, sha256 } from "./security.mjs";

const UCHIHA_API_1_ALIAS = "UCHIHA API 1";
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericMinor(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed * 100));
}

function firstArray(value, keys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === "object") {
      const nested = firstArray(value[key], keys);
      if (nested.length) return nested;
    }
  }
  return [];
}

function safeProviderError(error) {
  return String(error?.message || error || "Provider operation failed")
    .replace(/\b(bot)?\d{5,}:[A-Za-z0-9_-]{20,}\b/g, "bot<redacted>")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1<redacted>@")
    .replace(/([?&](?:token|api[_-]?key|secret|key)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>")
    .slice(0, 1000);
}

export class ProviderAdapter {
  constructor({ provider, credential, logger = console }) {
    this.provider = provider;
    this.credential = credential;
    this.logger = logger;
  }

  async testConnection() {
    throw new Error("testConnection is not implemented");
  }

  async listCategories() {
    throw new Error("listCategories is not implemented");
  }

  async listServices() {
    throw new Error("listServices is not implemented");
  }

  async createOrder() {
    throw new Error("createOrder is not implemented");
  }

  async checkOrder() {
    throw new Error("checkOrder is not implemented");
  }

  async getBalance() {
    throw new Error("getBalance is not implemented");
  }

  async cancelOrder() {
    return { ok: false, supported: false, status: "requires_review" };
  }

  normalizeWebhook() {
    throw new Error("normalizeWebhook is not implemented");
  }
}

export class HttpJsonV1Adapter extends ProviderAdapter {
  constructor(options) {
    super(options);
    this.baseUrl = String(options.provider.base_url || "").replace(/\/+$/, "");
    this.testMode = Boolean(options.provider.test_mode);
  }

  headers() {
    return {
      "api-token": this.credential,
      "content-type": "application/json",
      "user-agent": "UCHIHA-Builder/0.3"
    };
  }

  async request(path, { method = "GET", params = {}, attempts = 3 } = {}) {
    if (!this.baseUrl) {
      throw new Error("Provider base URL is not configured");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(url, {
          method,
          headers: this.headers(),
          signal: controller.signal
        });
        const text = await response.text();
        let payload = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { message: text.slice(0, 1000) };
        }
        if (response.ok) return { ok: true, status: response.status, payload };
        if (!RETRYABLE_STATUS.has(response.status) || attempt === attempts) {
          return {
            ok: false,
            definitiveFailure: response.status >= 400 && response.status < 500 && !RETRYABLE_STATUS.has(response.status),
            status: response.status,
            payload
          };
        }
        lastError = new Error(`Provider returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
      } finally {
        clearTimeout(timer);
      }
      await sleep(Math.min(5000, 400 * 2 ** (attempt - 1)));
    }
    return {
      ok: false,
      definitiveFailure: false,
      status: 0,
      payload: { message: lastError?.message || "Provider request failed" }
    };
  }

  async testConnection() {
    if (this.testMode) return { ok: true, mode: "test", balanceMinor: 250000 };
    const result = await this.request("/profile");
    return {
      ok: result.ok,
      mode: "live",
      balanceMinor: result.ok ? numericMinor(result.payload.balance) : null,
      error: result.ok ? null : result.payload?.message || `HTTP ${result.status}`
    };
  }

  async listCategories() {
    if (this.testMode) {
      return [
        { externalId: "games", name: "الألعاب والشحن", raw: { source: "test-catalog" } },
        { externalId: "digital", name: "البطاقات والاشتراكات", raw: { source: "test-catalog" } }
      ];
    }
    const result = await this.request("/content/0", { attempts: 5 });
    if (!result.ok) throw new Error(result.payload?.message || `Provider categories failed: ${result.status}`);
    const items = firstArray(result.payload, ["categories", "data", "items", "content"]);
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        externalId: String(item.id ?? item.category_id ?? item.slug ?? item.name),
        name: String(item.name ?? item.title ?? item.category_name ?? "خدمات رقمية"),
        raw: item
      }));
  }

  async listServices() {
    if (this.testMode) {
      return [
        {
          externalId: "game-100",
          categoryExternalId: "games",
          name: "شحن ألعاب — 100 وحدة",
          description: "خدمة شحن تجريبية آمنة لا ترسل طلبًا خارجيًا.",
          costMinor: 125,
          currency: this.provider.currency,
          minimum: 1,
          maximum: 20,
          fields: [{ key: "player_id", label: "معرف اللاعب", type: "text", required: true }],
          options: []
        },
        {
          externalId: "game-500",
          categoryExternalId: "games",
          name: "شحن ألعاب — 500 وحدة",
          description: "خدمة شحن تجريبية لاستخدام الـ Vertical Slice.",
          costMinor: 550,
          currency: this.provider.currency,
          minimum: 1,
          maximum: 10,
          fields: [{ key: "player_id", label: "معرف اللاعب", type: "text", required: true }],
          options: []
        },
        {
          externalId: "digital-30",
          categoryExternalId: "digital",
          name: "اشتراك رقمي — 30 يومًا",
          description: "اشتراك رقمي تجريبي.",
          costMinor: 300,
          currency: this.provider.currency,
          minimum: 1,
          maximum: 5,
          fields: [{ key: "account", label: "البريد أو اسم الحساب", type: "text", required: true }],
          options: []
        }
      ];
    }
    const result = await this.request("/products", { attempts: 5 });
    if (!result.ok) throw new Error(result.payload?.message || `Provider services failed: ${result.status}`);
    const items = firstArray(result.payload, ["products", "data", "items", "services"]);
    return items
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        externalId: String(item.id ?? item.product_id ?? item.sku),
        categoryExternalId: String(item.category_id ?? item.categoryId ?? "uncategorized"),
        name: String(item.name ?? item.title ?? item.product_name ?? "خدمة رقمية"),
        description: String(item.description ?? ""),
        costMinor: numericMinor(item.price ?? item.cost ?? item.sell_price),
        currency: String(item.currency ?? this.provider.currency),
        minimum: Number(item.min ?? item.minimum ?? 1) || 1,
        maximum: Number(item.max ?? item.maximum ?? 0) || null,
        fields: Array.isArray(item.fields) ? item.fields : [],
        options: Array.isArray(item.options) ? item.options : [],
        raw: item
      }));
  }

  async createOrder({ externalServiceId, quantity, inputs, idempotencyKey }) {
    if (this.testMode) {
      return {
        ok: true,
        status: "completed",
        externalOrderId: `test-${idempotencyKey.slice(0, 12)}`,
        payload: { simulated: true, quantity, acceptedFields: Object.keys(inputs || {}) }
      };
    }
    const params = {
      qty: quantity,
      order_uuid: idempotencyKey,
      ...inputs
    };
    const result = await this.request(`/newOrder/${encodeURIComponent(externalServiceId)}/params`, {
      method: "POST",
      params,
      attempts: 3
    });
    const externalOrderId = result.payload?.id ?? result.payload?.order_id ?? result.payload?.data?.id ?? null;
    return {
      ok: result.ok,
      definitiveFailure: result.definitiveFailure,
      status: result.ok ? "submitted" : result.definitiveFailure ? "failed" : "requires_review",
      externalOrderId: externalOrderId ? String(externalOrderId) : null,
      payload: result.payload,
      error: result.ok ? null : result.payload?.message || `HTTP ${result.status}`
    };
  }

  async checkOrder(externalOrderId) {
    if (this.testMode) return { ok: true, status: "completed", payload: { simulated: true } };
    const result = await this.request("/check", {
      params: { orders: JSON.stringify([externalOrderId]) }
    });
    const first = firstArray(result.payload, ["data", "orders", "items"])[0];
    return {
      ok: result.ok,
      status: first?.status || (result.ok ? "processing" : "requires_review"),
      payload: result.payload
    };
  }

  async getBalance() {
    const connection = await this.testConnection();
    return { ok: connection.ok, balanceMinor: connection.balanceMinor };
  }

  async cancelOrder(externalOrderId) {
    if (this.testMode) {
      return {
        ok: true,
        supported: true,
        status: "cancelled",
        payload: { simulated: true, externalOrderId }
      };
    }
    return { ok: false, supported: false, status: "requires_review", payload: {} };
  }

  normalizeWebhook(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const order = body.data?.order || body.order || body.data || body;
    const externalOrderId = order.id ?? order.order_id ?? order.orderId ?? order.external_order_id;
    if (externalOrderId === undefined || externalOrderId === null || externalOrderId === "") {
      throw new Error("Provider webhook is missing an external order id");
    }
    return {
      externalOrderId: String(externalOrderId).slice(0, 240),
      status: normalizedProviderStatus(order.status ?? body.status, "requires_review")
    };
  }
}

export function providerAdapter({ provider, credential, logger }) {
  if (provider.adapter_key === "mock") {
    return new HttpJsonV1Adapter({
      provider: { ...provider, test_mode: true, base_url: "" },
      credential: credential || "",
      logger
    });
  }
  if (provider.adapter_key === "http-json-v1") {
    return new HttpJsonV1Adapter({ provider, credential, logger });
  }
  throw new Error(`Unsupported provider adapter: ${provider.adapter_key}`);
}

async function providerCredentialByKey(db, provider, config, credentialKey) {
  const credentialRow = (
    await db.query(
      `SELECT credentials_ciphertext FROM api_provider_credentials
       WHERE provider_id=$1 AND credential_key=$2`,
      [provider.id, credentialKey]
    )
  ).rows[0];
  const ciphertext = credentialRow?.credentials_ciphertext ||
    (credentialKey === "primary" ? provider.credentials_ciphertext : null);
  if (!ciphertext) {
    if (credentialKey === "primary" && provider.test_mode) return "";
    throw new Error("Provider credentials are not configured");
  }
  return decryptSecret(ciphertext, config.encryptionKey);
}

async function providerCredential(db, provider, config) {
  return providerCredentialByKey(db, provider, config, "primary");
}

export async function verifyProviderWebhookSecret(db, provider, config, providedSecret) {
  if (!providedSecret || !provider) return false;
  let expected;
  try {
    expected = await providerCredentialByKey(db, provider, config, "webhook");
  } catch {
    return false;
  }
  const actualDigest = Buffer.from(sha256(providedSecret), "hex");
  const expectedDigest = Buffer.from(sha256(expected), "hex");
  return actualDigest.length === expectedDigest.length && timingSafeEqual(actualDigest, expectedDigest);
}

export function publicProvider(provider) {
  return {
    id: provider.id,
    name: provider.public_alias,
    currency: provider.currency,
    connectionStatus: provider.connection_status,
    testMode: provider.test_mode,
    lastCheckedAt: provider.last_checked_at
  };
}

export async function syncProvider(db, providerId, config, logger = console) {
  const providerResult = await db.query("SELECT * FROM api_providers WHERE id = $1", [providerId]);
  const provider = providerResult.rows[0];
  if (!provider) throw new Error("Provider not found");
  const syncId = randomUUID();
  const startedAt = new Date();
  await db.query(
    `INSERT INTO provider_sync_logs (id, provider_id, status, started_at)
     VALUES ($1, $2, 'running', $3)`,
    [syncId, provider.id, startedAt]
  );

  try {
    const adapter = providerAdapter({
      provider,
      credential: await providerCredential(db, provider, config),
      logger
    });
    const connection = await adapter.testConnection();
    if (!connection.ok) throw new Error(connection.error || "Provider connection failed");
    const [categories, services] = await Promise.all([
      adapter.listCategories(),
      adapter.listServices()
    ]);

    const categoryIds = new Map();
    await db.transaction(async (client) => {
      for (const category of categories) {
        const existing = await client.query(
          "SELECT id FROM api_categories WHERE provider_id = $1 AND external_id = $2",
          [provider.id, category.externalId]
        );
        const id = existing.rows[0]?.id || randomUUID();
        categoryIds.set(category.externalId, id);
        await client.query(
          `INSERT INTO api_categories (id, provider_id, external_id, public_name, status, raw_data, updated_at)
           VALUES ($1, $2, $3, $4, 'active', $5, NOW())
           ON CONFLICT (provider_id, external_id)
           DO UPDATE SET public_name = EXCLUDED.public_name, status = 'active',
                         raw_data = EXCLUDED.raw_data, updated_at = NOW()`,
          [id, provider.id, category.externalId, category.name, category.raw || {}]
        );
      }

      for (const service of services) {
        let categoryId = categoryIds.get(service.categoryExternalId) || null;
        if (!categoryId && service.categoryExternalId) {
          const existingCategory = await client.query(
            "SELECT id FROM api_categories WHERE provider_id = $1 AND external_id = $2",
            [provider.id, service.categoryExternalId]
          );
          categoryId = existingCategory.rows[0]?.id || randomUUID();
          await client.query(
            `INSERT INTO api_categories (id, provider_id, external_id, public_name, status, raw_data, updated_at)
             VALUES ($1, $2, $3, $4, 'active', '{}', NOW())
             ON CONFLICT (provider_id, external_id) DO NOTHING`,
            [categoryId, provider.id, service.categoryExternalId, "خدمات رقمية"]
          );
        }
        const existing = await client.query(
          "SELECT id FROM api_services WHERE provider_id = $1 AND external_id = $2",
          [provider.id, service.externalId]
        );
        const serviceId = existing.rows[0]?.id || randomUUID();
        await client.query(
          `INSERT INTO api_services (
             id, provider_id, api_category_id, external_id, public_name,
             public_description, original_cost_minor, currency, minimum_quantity,
             maximum_quantity, fields, options, provider_status, raw_data, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active', $13, NOW()
           )
           ON CONFLICT (provider_id, external_id)
           DO UPDATE SET api_category_id = EXCLUDED.api_category_id,
                         original_cost_minor = EXCLUDED.original_cost_minor,
                         currency = EXCLUDED.currency,
                         minimum_quantity = EXCLUDED.minimum_quantity,
                         maximum_quantity = EXCLUDED.maximum_quantity,
                         fields = EXCLUDED.fields,
                         options = EXCLUDED.options,
                         provider_status = 'active',
                         raw_data = EXCLUDED.raw_data,
                         updated_at = NOW()`,
          [
            serviceId,
            provider.id,
            categoryId,
            service.externalId,
            service.name,
            service.description || "",
            service.costMinor,
            service.currency,
            service.minimum || 1,
            service.maximum,
            JSON.stringify(service.fields || []),
            JSON.stringify(service.options || []),
            service.raw || {}
          ]
        );
        await client.query("DELETE FROM api_service_fields WHERE api_service_id=$1", [serviceId]);
        for (const [fieldIndex, rawField] of (service.fields || []).entries()) {
          const field = rawField && typeof rawField === "object" ? rawField : { key: `field_${fieldIndex + 1}`, label: String(rawField || "") };
          const fieldKey = String(field.key || field.name || `field_${fieldIndex + 1}`).slice(0, 120);
          const rawType = String(field.type || "text");
          const fieldType = new Set(["text", "textarea", "number", "email", "tel", "url", "select", "radio", "checkbox"]).has(rawType)
            ? rawType
            : "text";
          await client.query(
            `INSERT INTO api_service_fields (
               id, provider_id, api_service_id, field_key, label, field_type,
               is_required, validation, options, sort_order
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              randomUUID(),
              provider.id,
              serviceId,
              fieldKey,
              String(field.label || field.name || fieldKey).slice(0, 240),
              fieldType,
              Boolean(field.required),
              JSON.stringify(field.validation || {}),
              JSON.stringify(Array.isArray(field.options) ? field.options : []),
              (fieldIndex + 1) * 10
            ]
          );
        }
        await client.query("DELETE FROM api_service_options WHERE api_service_id=$1", [serviceId]);
        for (const [optionIndex, rawOption] of (service.options || []).entries()) {
          const option = rawOption && typeof rawOption === "object"
            ? rawOption
            : { id: `option_${optionIndex + 1}`, label: String(rawOption || ""), value: String(rawOption || "") };
          const externalId = String(option.id || option.key || option.value || `option_${optionIndex + 1}`).slice(0, 160);
          await client.query(
            `INSERT INTO api_service_options (
               id, provider_id, api_service_id, external_id, label, value,
               extra_cost_minor, metadata, status, sort_order
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
            [
              randomUUID(),
              provider.id,
              serviceId,
              externalId,
              String(option.label || option.name || option.value || externalId).slice(0, 240),
              String(option.value || option.id || externalId).slice(0, 500),
              Number.isFinite(Number(option.extraCostMinor)) ? Math.max(0, Math.round(Number(option.extraCostMinor))) : 0,
              JSON.stringify(option.metadata || {}),
              (optionIndex + 1) * 10
            ]
          );
        }
      }

      await client.query(
        `UPDATE api_providers
         SET connection_status = 'connected', balance_minor = $2,
             last_checked_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [provider.id, connection.balanceMinor]
      );
      await client.query(
        `UPDATE provider_sync_logs
         SET status = 'completed', categories_count = $2, services_count = $3, finished_at = NOW()
         WHERE id = $1`,
        [syncId, categories.length, services.length]
      );
    });

    const refreshedProvider = (
      await db.query("SELECT * FROM api_providers WHERE id = $1", [provider.id])
    ).rows[0];
    return {
      syncId,
      provider: publicProvider(refreshedProvider),
      categories: categories.length,
      services: services.length
    };
  } catch (error) {
    const safeError = safeProviderError(error);
    await db.query(
      `UPDATE provider_sync_logs
       SET status = 'failed', error_message = $2, finished_at = NOW()
       WHERE id = $1`,
      [syncId, safeError]
    );
    await db.query(
      `UPDATE api_providers
       SET connection_status = 'failed', last_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [provider.id]
    );
    await db.query(
      `INSERT INTO provider_errors (
         id, provider_id, sync_log_id, error_code, error_category,
         safe_message, retryable, metadata
       ) VALUES ($1,$2,$3,'sync_failed','sync',$4,TRUE,$5)`,
      [
        randomUUID(),
        provider.id,
        syncId,
        safeError,
        JSON.stringify({ operation: "sync" })
      ]
    );
    throw error;
  }
}

export async function executeProviderOrder(db, providerOrderId, config, logger = console) {
  const result = await db.query(
    `SELECT po.*, p.adapter_key, p.base_url, p.currency AS provider_currency,
            p.test_mode, p.credentials_ciphertext, p.retry_settings,
            s.external_id, o.status AS local_order_status
     FROM provider_orders po
     JOIN api_providers p ON p.id = po.provider_id
     JOIN api_services s ON s.id = po.api_service_id
     JOIN orders o ON o.id = po.order_id
     WHERE po.id = $1`,
    [providerOrderId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Provider order not found");
  if (!["pending", "requires_review"].includes(row.status)) return row;

  const attemptsResult = await db.query(
    "SELECT COUNT(*)::int AS count FROM provider_order_attempts WHERE provider_order_id = $1",
    [row.id]
  );
  const attemptNumber = Number(attemptsResult.rows[0].count) + 1;
  const provider = {
    id: row.provider_id,
    adapter_key: row.adapter_key,
    base_url: row.base_url,
    currency: row.provider_currency,
    test_mode: row.test_mode,
    credentials_ciphertext: row.credentials_ciphertext,
    retry_settings: row.retry_settings
  };
  const adapter = providerAdapter({
    provider,
    credential: await providerCredential(db, provider, config),
    logger
  });
  let response;
  try {
    response = await adapter.createOrder({
      externalServiceId: row.external_id,
      quantity: Number(row.request_payload?.quantity || 1),
      inputs: row.request_payload?.inputs || {},
      idempotencyKey: row.idempotency_key
    });
  } catch (error) {
    response = {
      ok: false,
      status: "requires_review",
      payload: {},
      error: safeProviderError(error)
    };
  }

  const retrySettings = row.retry_settings && typeof row.retry_settings === "object"
    ? row.retry_settings
    : {};
  const maximumAttempts = Math.max(1, Number(retrySettings.maxAttempts || 5));
  const baseDelaySeconds = Math.max(1, Number(retrySettings.baseDelaySeconds || 10));
  const shouldRetry =
    !response.ok &&
    !response.definitiveFailure &&
    attemptNumber < maximumAttempts;
  const persistedStatus = shouldRetry ? "pending" : response.status;
  const nextAttemptAt = shouldRetry
    ? new Date(Date.now() + Math.min(3_600_000, baseDelaySeconds * 1000 * 2 ** (attemptNumber - 1)))
    : null;
  const safeError = response.error ? safeProviderError(response.error) : null;

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO provider_order_attempts (
         id, tenant_id, store_id, provider_order_id, attempt_number,
         status, response_code, error_message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        row.tenant_id,
        row.store_id,
        row.id,
        attemptNumber,
        response.ok ? "accepted" : "failed",
        response.status || null,
        safeError
      ]
    );
    await client.query(
      `UPDATE provider_orders
       SET external_order_id = COALESCE($2, external_order_id),
           status = $3, response_payload = $4, last_error = $5,
           attempt_count=$6, next_attempt_at=$7,
           next_status_check_at=CASE WHEN $3 IN ('submitted','processing') THEN $8 ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $9`,
      [
        row.id,
        response.externalOrderId,
        persistedStatus,
        response.payload || {},
        safeError,
        attemptNumber,
        nextAttemptAt,
        new Date(Date.now() + 30_000),
        row.tenant_id
      ]
    );
    const localStatus =
      persistedStatus === "completed"
        ? "completed"
        : persistedStatus === "failed"
          ? "failed"
          : persistedStatus === "requires_review"
            ? "requires_review"
            : "processing";
    await client.query(
      "UPDATE orders SET status=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3",
      [row.order_id, localStatus, row.tenant_id]
    );
    await client.query(
      `INSERT INTO outbox_events (
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1, $2, 'order', $3, $4, $5)`,
      [
        randomUUID(),
        row.tenant_id,
        row.order_id,
        `provider_order.${persistedStatus}`,
        { providerOrderId: row.id, status: persistedStatus, retryAt: nextAttemptAt }
      ]
    );
    if (!response.ok) {
      await client.query(
        `INSERT INTO provider_errors (
           id, tenant_id, store_id, provider_id, provider_order_id,
           error_code, error_category, safe_message, retryable,
           retry_count, next_retry_at, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,'order',$7,$8,$9,$10,$11)`,
        [
          randomUUID(),
          row.tenant_id,
          row.store_id,
          row.provider_id,
          row.id,
          response.definitiveFailure ? "order_rejected" : "order_attempt_failed",
          safeError || "Provider order attempt failed",
          shouldRetry,
          attemptNumber,
          nextAttemptAt,
          JSON.stringify({ externalServiceId: row.external_id })
        ]
      );
    }
  }, row.tenant_id);
  return { ...response, status: persistedStatus, retryAt: nextAttemptAt };
}

const PROVIDER_ORDER_STATUSES = new Set([
  "pending",
  "submitted",
  "processing",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "requires_review"
]);

function normalizedProviderStatus(value, fallback = "processing") {
  const normalized = String(value || "").toLowerCase();
  return PROVIDER_ORDER_STATUSES.has(normalized) ? normalized : fallback;
}

export async function refreshProviderOrder(db, providerOrderId, config, logger = console) {
  const row = (
    await db.query(
      `SELECT po.*, p.adapter_key, p.base_url, p.currency AS provider_currency,
              p.test_mode, p.credentials_ciphertext, s.external_id
       FROM provider_orders po
       JOIN api_providers p ON p.id=po.provider_id
       JOIN api_services s ON s.id=po.api_service_id
       WHERE po.id=$1`,
      [providerOrderId]
    )
  ).rows[0];
  if (!row) throw new Error("Provider order not found");
  if (!["submitted", "processing"].includes(row.status) || !row.external_order_id) return row;
  const provider = {
    id: row.provider_id,
    adapter_key: row.adapter_key,
    base_url: row.base_url,
    currency: row.provider_currency,
    test_mode: row.test_mode,
    credentials_ciphertext: row.credentials_ciphertext
  };
  const adapter = providerAdapter({
    provider,
    credential: await providerCredential(db, provider, config),
    logger
  });
  let response;
  try {
    response = await adapter.checkOrder(row.external_order_id);
  } catch (error) {
    response = {
      ok: false,
      status: "processing",
      payload: {},
      error: safeProviderError(error)
    };
  }
  const nextStatus = response.ok
    ? normalizedProviderStatus(response.status)
    : "processing";
  const nextCheckAt = ["submitted", "processing"].includes(nextStatus)
    ? new Date(Date.now() + 30_000)
    : null;
  const localStatus =
    nextStatus === "completed"
      ? "completed"
      : nextStatus === "partial"
        ? "partial"
        : nextStatus === "failed"
          ? "failed"
          : nextStatus === "requires_review"
            ? "requires_review"
            : nextStatus === "cancelled"
              ? "cancelled"
              : "processing";
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE provider_orders
       SET status=$2, response_payload=$3,
           last_error=$4, next_status_check_at=$5, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$6`,
      [
        row.id,
        nextStatus,
        response.payload || {},
        response.error ? safeProviderError(response.error) : null,
        nextCheckAt,
        row.tenant_id
      ]
    );
    await client.query(
      "UPDATE orders SET status=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3",
      [row.order_id, localStatus, row.tenant_id]
    );
    await client.query(
      `INSERT INTO outbox_events (
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1,$2,'order',$3,$4,$5)`,
      [
        randomUUID(),
        row.tenant_id,
        row.order_id,
        `provider_order.${nextStatus}`,
        { providerOrderId: row.id, status: nextStatus }
      ]
    );
    if (!response.ok) {
      await client.query(
        `INSERT INTO provider_errors (
           id, tenant_id, store_id, provider_id, provider_order_id,
           error_code, error_category, safe_message, retryable,
           retry_count, next_retry_at, metadata
         ) VALUES ($1,$2,$3,$4,$5,'status_check_failed','status',$6,TRUE,1,$7,$8)`,
        [
          randomUUID(),
          row.tenant_id,
          row.store_id,
          row.provider_id,
          row.id,
          safeProviderError(response.error || "Provider status check failed"),
          nextCheckAt,
          JSON.stringify({ externalOrderId: row.external_order_id })
        ]
      );
    }
  }, row.tenant_id);
  return { ...response, status: nextStatus, nextCheckAt };
}

export async function cancelProviderOrder(db, providerOrderId, config, logger = console) {
  const row = (
    await db.query(
      `SELECT po.*, p.adapter_key, p.base_url, p.currency AS provider_currency,
              p.test_mode, p.credentials_ciphertext
       FROM provider_orders po
       JOIN api_providers p ON p.id=po.provider_id
       WHERE po.id=$1`,
      [providerOrderId]
    )
  ).rows[0];
  if (!row) throw new Error("Provider order not found");
  if (["completed", "partial", "failed", "cancelled"].includes(row.status)) {
    return { ok: row.status === "cancelled", supported: true, status: row.status };
  }
  if (!row.external_order_id) {
    await db.query(
      `UPDATE provider_orders
       SET status='cancelled', cancellation_requested_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2`,
      [row.id, row.tenant_id]
    );
    await db.query(
      "UPDATE orders SET status='cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
      [row.order_id, row.tenant_id]
    );
    return { ok: true, supported: true, status: "cancelled", localOnly: true };
  }
  const provider = {
    id: row.provider_id,
    adapter_key: row.adapter_key,
    base_url: row.base_url,
    currency: row.provider_currency,
    test_mode: row.test_mode,
    credentials_ciphertext: row.credentials_ciphertext
  };
  const adapter = providerAdapter({
    provider,
    credential: await providerCredential(db, provider, config),
    logger
  });
  const response = await adapter.cancelOrder(row.external_order_id);
  const nextStatus = response.ok && response.status === "cancelled"
    ? "cancelled"
    : "requires_review";
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE provider_orders
       SET status=$2, cancellation_requested_at=NOW(),
           response_payload=$3, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$4`,
      [row.id, nextStatus, response.payload || {}, row.tenant_id]
    );
    await client.query(
      "UPDATE orders SET status=$2, updated_at=NOW() WHERE id=$1 AND tenant_id=$3",
      [row.order_id, nextStatus === "cancelled" ? "cancelled" : "requires_review", row.tenant_id]
    );
  }, row.tenant_id);
  return { ...response, status: nextStatus };
}

const TERMINAL_PROVIDER_STATUSES = new Set(["completed", "partial", "failed", "cancelled"]);

function localOrderStatus(providerStatus) {
  if (providerStatus === "completed") return "completed";
  if (providerStatus === "partial") return "partial";
  if (providerStatus === "failed") return "failed";
  if (providerStatus === "cancelled") return "cancelled";
  if (providerStatus === "requires_review") return "requires_review";
  return "processing";
}

export async function applyProviderWebhook(db, provider, payload, eventKey, logger = console) {
  const normalizedEventKey = String(eventKey || "").trim().slice(0, 240);
  if (!normalizedEventKey) throw new Error("Provider webhook event key is required");
  const payloadDigest = sha256(JSON.stringify(payload || {}));
  const previous = (
    await db.query(
      `SELECT id, outcome, received_status, payload_digest FROM provider_webhook_events
       WHERE provider_id=$1 AND event_key=$2`,
      [provider.id, normalizedEventKey]
    )
  ).rows[0];
  if (previous) {
    if (previous.payload_digest !== payloadDigest) {
      const error = new Error("Webhook event key was already used with a different payload");
      error.statusCode = 409;
      error.code = "webhook_idempotency_mismatch";
      throw error;
    }
    return {
      accepted: true,
      duplicate: true,
      matched: previous.outcome === "applied",
      status: previous.received_status || null
    };
  }

  let normalized;
  try {
    normalized = providerAdapter({ provider, credential: "", logger }).normalizeWebhook(payload);
  } catch (error) {
    await db.query(
      `INSERT INTO provider_webhook_events (
         id, provider_id, event_key, payload_digest, outcome, processed_at
       ) VALUES ($1,$2,$3,$4,'rejected',NOW())
       ON CONFLICT (provider_id, event_key) DO NOTHING`,
      [randomUUID(), provider.id, normalizedEventKey, payloadDigest]
    );
    throw error;
  }

  const order = (
    await db.query(
      `SELECT id, tenant_id, store_id, order_id, status
       FROM provider_orders
       WHERE provider_id=$1 AND external_order_id=$2`,
      [provider.id, normalized.externalOrderId]
    )
  ).rows[0];
  if (!order) {
    const insertedEvent = await db.query(
      `INSERT INTO provider_webhook_events (
         id, provider_id, event_key, payload_digest, received_status,
         outcome, processed_at
       ) VALUES ($1,$2,$3,$4,$5,'unmatched',NOW())
       ON CONFLICT (provider_id, event_key) DO NOTHING
       RETURNING id`,
      [randomUUID(), provider.id, normalizedEventKey, payloadDigest, normalized.status]
    );
    if (!insertedEvent.rows[0]) {
      const concurrent = (
        await db.query(
          `SELECT payload_digest FROM provider_webhook_events
           WHERE provider_id=$1 AND event_key=$2`,
          [provider.id, normalizedEventKey]
        )
      ).rows[0];
      if (concurrent?.payload_digest !== payloadDigest) {
        const error = new Error("Webhook event key was already used with a different payload");
        error.statusCode = 409;
        error.code = "webhook_idempotency_mismatch";
        throw error;
      }
    }
    return {
      accepted: true,
      duplicate: !insertedEvent.rows[0],
      matched: false,
      status: normalized.status
    };
  }

  const nextStatus = TERMINAL_PROVIDER_STATUSES.has(order.status)
    ? order.status
    : normalizedProviderStatus(normalized.status, "requires_review");
  let inserted = false;
  await db.transaction(async (client) => {
    const webhookEvent = await client.query(
      `INSERT INTO provider_webhook_events (
         id, tenant_id, store_id, provider_id, provider_order_id,
         event_key, payload_digest, received_status, outcome, processed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'applied',NOW())
       ON CONFLICT (provider_id, event_key) DO NOTHING
       RETURNING id`,
      [
        randomUUID(), order.tenant_id, order.store_id, provider.id, order.id,
        normalizedEventKey, payloadDigest, normalized.status
      ]
    );
    inserted = Boolean(webhookEvent.rows[0]);
    if (!inserted) {
      const concurrent = (
        await client.query(
          `SELECT payload_digest FROM provider_webhook_events
           WHERE provider_id=$1 AND event_key=$2`,
          [provider.id, normalizedEventKey]
        )
      ).rows[0];
      if (concurrent?.payload_digest !== payloadDigest) {
        const error = new Error("Webhook event key was already used with a different payload");
        error.statusCode = 409;
        error.code = "webhook_idempotency_mismatch";
        throw error;
      }
      return;
    }
    await client.query(
      `UPDATE provider_orders
       SET status=$2, next_status_check_at=NULL, last_error=NULL, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$3`,
      [order.id, nextStatus, order.tenant_id]
    );
    await client.query(
      `UPDATE orders SET status=$2, updated_at=NOW()
       WHERE id=$1 AND tenant_id=$3`,
      [order.order_id, localOrderStatus(nextStatus), order.tenant_id]
    );
    await client.query(
      `INSERT INTO outbox_events (
         id, tenant_id, aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1,$2,'order',$3,$4,$5)`,
      [
        randomUUID(), order.tenant_id, order.order_id,
        `provider_order.${nextStatus}`,
        { providerOrderId: order.id, status: nextStatus, source: "webhook" }
      ]
    );
  }, order.tenant_id);

  return {
    accepted: true,
    duplicate: !inserted,
    matched: true,
    status: nextStatus
  };
}

export { UCHIHA_API_1_ALIAS, safeProviderError };
