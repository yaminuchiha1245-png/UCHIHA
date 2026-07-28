import { randomUUID } from "node:crypto";
import { decryptSecret } from "./security.mjs";

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
}

export class UchihaApi1Adapter extends ProviderAdapter {
  constructor(options) {
    super(options);
    this.baseUrl = (options.provider.base_url || "https://api.js4card.com/client/api").replace(/\/+$/, "");
    this.testMode = Boolean(options.provider.test_mode);
  }

  headers() {
    return {
      "api-token": this.credential,
      "content-type": "application/json",
      "user-agent": "UCHIHA-Builder/0.1"
    };
  }

  async request(path, { method = "GET", params = {}, attempts = 3 } = {}) {
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
}

export function providerAdapter({ provider, credential, logger }) {
  if (provider.adapter_key === "jas4card") {
    return new UchihaApi1Adapter({ provider, credential, logger });
  }
  throw new Error(`Unsupported provider adapter: ${provider.adapter_key}`);
}

function providerCredential(provider, config) {
  if (!provider.credentials_ciphertext) {
    if (provider.test_mode) return "test-mode";
    throw new Error("Provider credentials are not configured");
  }
  return decryptSecret(provider.credentials_ciphertext, config.encryptionKey);
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
      credential: providerCredential(provider, config),
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
            service.fields || [],
            service.options || [],
            service.raw || {}
          ]
        );
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
    await db.query(
      `UPDATE provider_sync_logs
       SET status = 'failed', error_message = $2, finished_at = NOW()
       WHERE id = $1`,
      [syncId, String(error.message).slice(0, 1000)]
    );
    await db.query(
      `UPDATE api_providers
       SET connection_status = 'failed', last_checked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [provider.id]
    );
    throw error;
  }
}

export async function executeProviderOrder(db, providerOrderId, config, logger = console) {
  const result = await db.query(
    `SELECT po.*, p.adapter_key, p.base_url, p.currency AS provider_currency,
            p.test_mode, p.credentials_ciphertext, s.external_id, o.status AS local_order_status
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
    credentials_ciphertext: row.credentials_ciphertext
  };
  const adapter = providerAdapter({
    provider,
    credential: providerCredential(provider, config),
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
      error: error.message
    };
  }

  await db.transaction(async (client) => {
    await client.query(
      `INSERT INTO provider_order_attempts (
         id, tenant_id, provider_order_id, attempt_number, status, response_code, error_message
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        row.tenant_id,
        row.id,
        attemptNumber,
        response.ok ? "accepted" : "failed",
        response.status || null,
        response.error || null
      ]
    );
    await client.query(
      `UPDATE provider_orders
       SET external_order_id = COALESCE($2, external_order_id),
           status = $3, response_payload = $4, last_error = $5, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $6`,
      [row.id, response.externalOrderId, response.status, response.payload || {}, response.error || null, row.tenant_id]
    );
    const localStatus =
      response.status === "completed"
        ? "completed"
        : response.status === "failed"
          ? "failed"
          : response.status === "requires_review"
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
        `provider_order.${response.status}`,
        { providerOrderId: row.id, status: response.status }
      ]
    );
  }, row.tenant_id);
  return response;
}

export { UCHIHA_API_1_ALIAS };
