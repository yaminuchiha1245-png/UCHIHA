import { PERMISSIONS } from "@uchiha-radius/contracts";
import { notFound, validationError } from "./errors.js";
import { requirePermission, requireWrite } from "./guards.js";
import { writeAudit } from "./audit.js";
import { id, nowIso, pageFromQuery, parseJson } from "./utils.js";

// Balance is denominated in the tenant's currency. An independent subscriber
// quote is usable only if that exact currency was explicitly configured.
// Missing prices MUST NOT be guessed using an FX rate or the old plan price.
export function explicitPriceMinor(pricesJson, currency) {
  if (pricesJson == null) return null;
  const value = parseJson(pricesJson, {})[currency];
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const minor = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw validationError("السعر يتجاوز الحد المسموح");
  return Number(minor);
}

function invoiceNumber(date = new Date()) {
  const period = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `INV-${period}-${id("").replaceAll("_", "").slice(0, 8).toUpperCase()}`;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 86_400_000);
}

export function billingPeriod(cycle, input = new Date()) {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) throw validationError("تاريخ دورة الفوترة غير صالح");
  if (cycle === "monthly") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (cycle === "weekly") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - day + 1);
    return { start: start.toISOString(), end: addUtcDays(start, 7).toISOString() };
  }
  return null;
}

async function insertInvoice(db, { tenantId, subscriberId, amountMinor, currency, dueAt, periodStart = null, periodEnd = null }) {
  const invoiceId = id("inv"); const now = nowIso();
  const result = await db.run(`INSERT INTO invoices
    (id,tenant_id,subscriber_id,number,amount_minor,paid_minor,currency,status,due_at,period_start,period_end,void_reason,created_at,updated_at)
    VALUES (?,?,?,?,?,0,?,'unpaid',?,?,?,NULL,?,?) ON CONFLICT DO NOTHING`, [invoiceId, tenantId, subscriberId,
    invoiceNumber(new Date(now)), amountMinor, currency, dueAt, periodStart, periodEnd, now, now]);
  if (result.changes === 1) {
    await db.run("UPDATE subscribers SET balance_minor=balance_minor+?,updated_at=? WHERE id=? AND tenant_id=?",
      [amountMinor, now, subscriberId, tenantId]);
    return invoiceId;
  }
  if (periodStart) {
    const existing = await db.get(`SELECT id FROM invoices
      WHERE tenant_id=? AND subscriber_id=? AND period_start=? AND status<>'void'`, [tenantId, subscriberId, periodStart]);
    if (existing) return null;
  }
  throw new Error("Invoice insert conflicted without an existing billing period");
}

export async function generateTenantInvoices(db, tenantId, { asOf = nowIso(), dueDays = 7, reason = null, context = null } = {}) {
  const tenant = await db.get("SELECT id,currency,status FROM tenants WHERE id=?", [tenantId]);
  if (!tenant || tenant.status !== "active") return { tenantId, created: 0, skipped: 0, reason: "tenant_inactive" };
  const rows = await db.all(`SELECT s.id AS subscriber_id,p.id AS plan_id,p.price_minor,p.billing_cycle,ap.prices_json
    FROM subscribers s JOIN plans p ON p.id=s.plan_id
    LEFT JOIN subscriber_access_profiles ap ON ap.tenant_id=s.tenant_id AND ap.subscriber_id=s.id
    WHERE s.tenant_id=? AND s.status='active' AND p.status='active'`, [tenantId]);
  let created = 0; let skipped = 0; const createdIds = [];
  for (const row of rows) {
    const period = billingPeriod(row.billing_cycle, asOf);
    if (!period) { skipped += 1; continue; }
    const amountMinor = row.prices_json == null ? Number(row.price_minor) : explicitPriceMinor(row.prices_json,tenant.currency);
    if (amountMinor === null || amountMinor <= 0) { skipped += 1; continue; }
    const invoiceId = await insertInvoice(db, { tenantId, subscriberId: row.subscriber_id,
      amountMinor, currency: tenant.currency,
      dueAt: addUtcDays(new Date(asOf), dueDays).toISOString(), periodStart: period.start, periodEnd: period.end });
    if (invoiceId) { created += 1; createdIds.push(invoiceId); } else skipped += 1;
  }
  await writeAudit(db, context, { tenantId, actorType: context ? "user" : "system", action: "billing.invoices.generate",
    entityType: "billing_run", entityId: periodRunId(asOf), reason,
    after: { asOf, dueDays, created, skipped, invoiceIds: createdIds.slice(0, 100) } });
  return { tenantId, asOf, dueDays, created, skipped };
}

function periodRunId(asOf) {
  return `run_${String(asOf).slice(0, 10).replaceAll("-", "")}`;
}

export class BillingService {
  constructor({ db }) {
    this.db = db;
  }

  async listPayments(context, query = {}) {
    requirePermission(context, PERMISSIONS.BILLING_READ); const { limit, offset } = pageFromQuery(query);
    const rows = await this.db.all(`SELECT p.id,p.invoice_id,p.amount_minor,p.method,p.reference,p.created_at,
      i.number AS invoice_number,s.id AS subscriber_id,s.full_name,s.username,u.display_name AS received_by
      FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN subscribers s ON s.id=i.subscriber_id
      LEFT JOIN users u ON u.id=p.received_by_user_id WHERE p.tenant_id=? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [context.tenantId, limit, offset]);
    const count = await this.db.get("SELECT COUNT(*) AS total FROM payments WHERE tenant_id=?", [context.tenantId]);
    return { items: rows.map((row) => ({ id: row.id, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number,
      subscriberId: row.subscriber_id, subscriberName: row.full_name, username: row.username,
      amountMinor: Number(row.amount_minor), method: row.method, reference: row.reference,
      receivedBy: row.received_by, createdAt: row.created_at })), pagination: { limit, offset, total: Number(count.total) } };
  }

  async createInvoice(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.BILLING_WRITE);
    const subscriber = await db.get(`SELECT s.id,s.full_name,s.status,p.price_minor,ap.prices_json FROM subscribers s
      LEFT JOIN plans p ON p.id=s.plan_id
      LEFT JOIN subscriber_access_profiles ap ON ap.tenant_id=s.tenant_id AND ap.subscriber_id=s.id
      WHERE s.id=? AND s.tenant_id=?`, [input.subscriberId, context.tenantId]);
    if (!subscriber) throw notFound("المشترك غير موجود");
    const tenant = await db.get("SELECT currency FROM tenants WHERE id=?", [context.tenantId]);
    const amountMinor = input.amountMinor ?? (subscriber.prices_json == null
      ? Number(subscriber.price_minor ?? 0) : explicitPriceMinor(subscriber.prices_json,tenant.currency));
    if (amountMinor == null) throw validationError("لا يوجد سعر محدد بعملة الشبكة؛ أضف سعرًا مستقلاً أو أدخل قيمة الفاتورة يدويًا");
    if (amountMinor <= 0) throw validationError("قيمة الفاتورة يجب أن تكون أكبر من صفر");
    const invoiceId = await insertInvoice(db, { tenantId: context.tenantId, subscriberId: subscriber.id,
      amountMinor, currency: tenant.currency, dueAt: input.dueAt, periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null });
    if (!invoiceId) throw validationError("توجد فاتورة لهذه الدورة بالفعل");
    await writeAudit(db, context, { action: "invoice.create", entityType: "invoice", entityId: invoiceId,
      reason: input.reason, after: { subscriberId: subscriber.id, amountMinor, dueAt: input.dueAt,
        periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null } });
    return { id: invoiceId, subscriberId: subscriber.id, subscriberName: subscriber.full_name,
      amountMinor, paidMinor: 0, currency: tenant.currency, status: "unpaid", dueAt: input.dueAt };
  }

  async voidInvoice(context, invoiceId, reason, db = this.db) {
    requireWrite(context, PERMISSIONS.BILLING_WRITE);
    const lock = db.driver === "postgres" ? " FOR UPDATE" : "";
    const invoice = await db.get(`SELECT * FROM invoices WHERE id=? AND tenant_id=?${lock}`, [invoiceId, context.tenantId]);
    if (!invoice) throw notFound("الفاتورة غير موجودة");
    if (invoice.status === "void") return { id: invoiceId, status: "void", changed: false };
    if (invoice.status === "paid") throw validationError("الفاتورة مدفوعة؛ سجّل عملية استرداد مستقلة بدل إلغائها");
    const outstanding = Math.max(0, Number(invoice.amount_minor) - Number(invoice.paid_minor)); const now = nowIso();
    await db.run("UPDATE invoices SET status='void',void_reason=?,updated_at=? WHERE id=? AND tenant_id=?", [reason, now, invoiceId, context.tenantId]);
    await db.run(`UPDATE subscribers SET balance_minor=CASE WHEN balance_minor>=? THEN balance_minor-? ELSE 0 END,updated_at=?
      WHERE id=? AND tenant_id=?`, [outstanding, outstanding, now, invoice.subscriber_id, context.tenantId]);
    await writeAudit(db, context, { action: "invoice.void", entityType: "invoice", entityId: invoiceId, reason,
      before: { status: invoice.status, outstandingMinor: outstanding }, after: { status: "void" } });
    return { id: invoiceId, status: "void", changed: true };
  }

  async generate(context, input, db = this.db) {
    requireWrite(context, PERMISSIONS.BILLING_WRITE);
    return generateTenantInvoices(db, context.tenantId, {
      asOf: input.asOf ?? nowIso(), dueDays: input.dueDays, reason: input.reason, context
    });
  }
}
