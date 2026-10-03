import { decryptSecret } from "./security.js";
import { nowIso, parseJson } from "./utils.js";

export class OutboxWorker {
  constructor({ db, config, fetchImpl = globalThis.fetch, logger = console }) {
    this.db = db;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.activeTick = Promise.resolve();
  }

  async start(intervalMs = 2_000) {
    if (this.timer) return;
    const tick = () => {
      if (this.running) return this.activeTick;
      this.running = true;
      this.activeTick = this.runOnce().catch((error) => {
        this.logger.error?.({ error }, "outbox worker failed");
      }).finally(() => {
        this.running = false;
      });
      return this.activeTick;
    };
    await tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeTick;
  }

  async runOnce() {
    return this.runOnceScoped();
  }

  async runOnceScoped() {
    const job = await this.claimNext();
    if (!job) return null;
    try {
      await this.dispatch(job);
      await this.db.run("UPDATE outbox SET status = 'sent', locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", [nowIso(), job.id]);
      return { id: job.id, status: "sent" };
    } catch (error) {
      const delaySeconds = Math.min(300, 2 ** (Number(job.attempts) + 1));
      const availableAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
      await this.db.run("UPDATE outbox SET status = 'failed', locked_at = NULL, last_error = ?, available_at = ?, updated_at = ? WHERE id = ?",
        [String(error?.message ?? error).slice(0, 500), availableAt, nowIso(), job.id]);
      return { id: job.id, status: "failed" };
    }
  }

  async claimNext() {
    return this.db.transaction(async (tx) => {
      const now = nowIso();
      const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
      const lock = tx.driver === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
      const billingFilter = this.config.billingCheckoutEndpoint ? "" : "AND topic <> 'billing.checkout.create'";
      const job = await tx.get(`SELECT * FROM outbox
        WHERE attempts < 8
          AND topic NOT IN ('radius.subscriber.sync', 'radius.session.disconnect', 'radius.directory.refresh')
          ${billingFilter}
          AND ((status IN ('pending', 'failed') AND available_at <= ?)
            OR (status = 'processing' AND locked_at <= ?))
        ORDER BY available_at ASC LIMIT 1${lock}`, [now, staleBefore]);
      if (!job) return null;
      const claimed = await tx.run(`UPDATE outbox SET status = 'processing', locked_at = ?, attempts = attempts + 1,
        updated_at = ? WHERE id = ?`, [now, now, job.id]);
      if (claimed.changes !== 1) return null;
      return { ...job, status: "processing", attempts: Number(job.attempts) + 1, locked_at: now };
    });
  }

  async dispatch(job) {
    const payload = parseJson(job.payload_json, {});
    if (job.topic === "telegram.message") return this.sendTelegram(payload);
    if (job.topic === "telegram.alert") {
      const integration = await this.db.get("SELECT * FROM integrations WHERE tenant_id = ? AND type = 'telegram' AND status = 'active'", [job.tenant_id]);
      if (!integration) return;
      const config = parseJson(integration.config_json, {});
      if (Array.isArray(config.enabledSeverities) && !config.enabledSeverities.includes(payload.severity)) return;
      const secret = JSON.parse(decryptSecret(integration.secret_ciphertext, this.config.encryptionKey));
      try {
        await this.sendTelegram({ chatId: secret.chatId, text: `⚠️ ${payload.title}\n${payload.body}` });
        const now = nowIso();
        await this.db.run("UPDATE integrations SET last_seen_at = ?, last_error = NULL, updated_at = ? WHERE id = ?", [now, now, integration.id]);
        return;
      } catch (error) {
        await this.db.run("UPDATE integrations SET last_error = ?, updated_at = ? WHERE id = ?", [String(error?.message ?? error).slice(0, 500), nowIso(), integration.id]);
        throw error;
      }
    }
    if (job.topic === "billing.checkout.create") {
      return this.createBillingCheckout(job, payload);
    }
    throw new Error(`Unsupported outbox topic: ${job.topic}`);
  }

  async createBillingCheckout(job, payload) {
    if (!this.config.billingCheckoutEndpoint || !this.config.billingCheckoutToken) {
      throw new Error("Billing checkout adapter is not configured");
    }
    const subscription = await this.db.get("SELECT status FROM tenant_subscriptions WHERE id = ? AND tenant_id = ?", [payload.subscriptionId, job.tenant_id]);
    if (!subscription) throw new Error("Billing subscription no longer exists");
    if (subscription.status !== "pending") return;
    const publicBaseUrl = String(this.config.publicBaseUrl).replace(/\/$/, "");
    const body = JSON.stringify({
      idempotencyKey: job.id,
      ...payload,
      successUrl: `${publicBaseUrl}/provider/#subscriptions`,
      cancelUrl: `${publicBaseUrl}/provider/#subscriptions`,
      webhookUrl: `${publicBaseUrl}/webhooks/billing`
    });
    const response = await this.fetchImpl(this.config.billingCheckoutEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.config.billingCheckoutToken}`,
        "content-type": "application/json",
        "x-idempotency-key": job.id
      },
      body,
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Billing checkout returned ${response.status}`);
    const checkoutUrl = String(result.checkoutUrl ?? "");
    const externalId = String(result.externalId ?? "");
    const provider = String(result.provider ?? "external").slice(0, 80);
    let checkoutTarget;
    try { checkoutTarget = new URL(checkoutUrl); } catch { throw new Error("Billing checkout returned an invalid HTTPS URL"); }
    const allowedHosts = this.config.billingCheckoutAllowedHosts ?? [];
    if (checkoutTarget.protocol !== "https:" || checkoutTarget.username || checkoutTarget.password || checkoutUrl.length > 2_000) {
      throw new Error("Billing checkout returned an invalid HTTPS URL");
    }
    if (allowedHosts.length && !allowedHosts.includes(checkoutTarget.hostname.toLowerCase())) {
      throw new Error("Billing checkout returned a host outside the allowlist");
    }
    if (!externalId || externalId.length > 200) throw new Error("Billing checkout returned an invalid external ID");
    const expiresAt = result.expiresAt && !Number.isNaN(new Date(result.expiresAt).getTime())
      ? new Date(result.expiresAt).toISOString()
      : null;
    const updated = await this.db.run(`UPDATE tenant_subscriptions
      SET provider = ?, external_id = ?, checkout_url = ?, checkout_expires_at = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
    [provider, externalId, checkoutUrl, expiresAt, nowIso(), payload.subscriptionId, job.tenant_id]);
    if (updated.changes !== 1) throw new Error("Billing subscription changed before checkout was saved");
  }

  async sendTelegram({ chatId, text, replyToMessageId }) {
    if (!this.config.telegramBotToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    if (!/^-?\d{1,24}$/.test(String(chatId ?? ""))) throw new Error("Telegram chat ID is invalid");
    if (!text || String(text).length > 4_096) throw new Error("Telegram message is empty or too long");
    const response = await this.fetchImpl(`https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  }
}
