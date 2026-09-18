import path from "node:path";
import fs from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z, ZodError } from "zod";
import { API_ERROR_CODES, APP_VERSION } from "@uchiha-radius/contracts";
import { AppError } from "./errors.js";
import { AuthService, bearerToken } from "./auth-service.js";
import { ProviderService } from "./provider-service.js";
import { OwnerService } from "./owner-service.js";
import { ConnectorService } from "./connector-service.js";
import { OperationalService } from "./operational-service.js";
import { BillingService } from "./billing-service.js";
import { IdempotencyService } from "./idempotency.js";
import { GoogleIdTokenVerifier, safeEqual, verifySignedPayload } from "./security.js";
import { MetricsRegistry } from "./metrics.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../../..");
const builtProviderRoot = path.join(projectRoot, "dist/provider");

function providerRootFor(nodeEnv) {
  if (fs.existsSync(path.join(builtProviderRoot, "index.html"))) return builtProviderRoot;
  if (nodeEnv === "production") throw new Error("Production provider bundle is missing; run provider:v183:server before launch");
  return path.join(projectRoot, "apps/provider-web");
}

const nonEmpty = z.string().trim().min(1);
const optionalText = z.string().trim().max(500).nullable().optional();
const reason = z.string().trim().min(3).max(500);
const ipAddress = z.string().trim().refine((value) => isIP(value) > 0, "عنوان IP غير صالح");
const cidr = z.string().trim().refine((value) => {
  const [address, maskText, extra] = value.split("/");
  const version = isIP(address);
  const mask = Number(maskText);
  return !extra && version > 0 && Number.isInteger(mask) && mask >= 0 && mask <= (version === 4 ? 32 : 128);
}, "نطاق CIDR غير صالح");

const schemas = {
  googleLogin: z.object({ credential: z.string().min(40) }).strict(),
  devLogin: z.object({ mode: z.enum(["provider", "owner"]).default("provider") }).strict(),
  activationRedeem: z.object({ activationCode: z.string().trim().min(20).max(40) }).strict(),
  subscriberCreate: z.object({
    username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._@-]+$/),
    radiusPassword: z.string().min(8).max(128).optional(),
    fullName: z.string().trim().min(2).max(120),
    phone: optionalText,
    address: optionalText,
    planId: z.string().trim().nullable().optional(),
    policyId: z.string().trim().nullable().optional(),
    ipPoolId: z.string().trim().nullable().optional(),
    serviceExpiresAt: z.iso.datetime().nullable().optional()
  }).strict(),
  subscriberUpdate: z.object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: optionalText,
    address: optionalText,
    planId: z.string().trim().nullable().optional(),
    policyId: z.string().trim().nullable().optional(),
    ipPoolId: z.string().trim().nullable().optional(),
    serviceExpiresAt: z.iso.datetime().nullable().optional()
  }).strict().refine((body) => Object.keys(body).length > 0, "لا توجد تغييرات"),
  subscriberCredential: z.object({ radiusPassword: z.string().min(8).max(128), reason }).strict(),
  statusReason: z.object({ reason }).strict(),
  subscriberRenew: z.object({ planId: z.string().trim().nullable().optional(), reason }).strict(),
  planCreate: z.object({
    name: z.string().trim().min(2).max(80),
    speedDownMbps: z.number().int().min(1).max(100000),
    speedUpMbps: z.number().int().min(1).max(100000),
    priceMinor: z.number().int().min(0).max(1_000_000_000),
    billingCycle: z.enum(["monthly", "weekly", "custom"]).default("monthly"),
    policyId: z.string().trim().nullable().optional(),
    ipPoolId: z.string().trim().nullable().optional(),
    quotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    quotaPeriod: z.enum(["none", "daily", "monthly"]).default("none"),
    quotaAction: z.enum(["block", "throttle"]).default("block"),
    throttleDownMbps: z.number().int().min(1).max(100000).nullable().optional(),
    throttleUpMbps: z.number().int().min(1).max(100000).nullable().optional(),
    durationDays: z.number().int().min(1).max(3660).default(30),
    simultaneousUse: z.number().int().min(1).max(100).default(1),
    scopeType: z.enum(["all", "device", "site"]).default("all"),
    scopeId: z.string().trim().nullable().optional()
  }).strict(),
  planUpdate: z.object({
    name: z.string().trim().min(2).max(80).optional(),
    speedDownMbps: z.number().int().min(1).max(100000).optional(),
    speedUpMbps: z.number().int().min(1).max(100000).optional(),
    priceMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    billingCycle: z.enum(["monthly", "weekly", "custom"]).optional(),
    policyId: z.string().trim().nullable().optional(),
    ipPoolId: z.string().trim().nullable().optional(),
    quotaBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    quotaPeriod: z.enum(["none", "daily", "monthly"]).optional(),
    quotaAction: z.enum(["block", "throttle"]).optional(),
    throttleDownMbps: z.number().int().min(1).max(100000).nullable().optional(),
    throttleUpMbps: z.number().int().min(1).max(100000).nullable().optional(),
    durationDays: z.number().int().min(1).max(3660).optional(),
    simultaneousUse: z.number().int().min(1).max(100).optional(),
    scopeType: z.enum(["all", "device", "site"]).optional(),
    scopeId: z.string().trim().nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    reason
  }).strict().refine((body) => Object.keys(body).some((key) => key !== "reason"), "لا توجد تغييرات"),
  payment: z.object({
    amountMinor: z.number().int().positive().max(1_000_000_000),
    method: z.enum(["cash", "transfer", "card", "other"]),
    reference: z.string().trim().max(120).nullable().optional(),
    reason: z.string().trim().min(3).max(500)
  }).strict(),
  invoiceCreate: z.object({
    subscriberId: nonEmpty,
    amountMinor: z.number().int().positive().max(1_000_000_000).optional(),
    dueAt: z.iso.datetime(),
    periodStart: z.iso.datetime().nullable().optional(),
    periodEnd: z.iso.datetime().nullable().optional(),
    reason
  }).strict().superRefine((body, context) => {
    const hasStart = Boolean(body.periodStart); const hasEnd = Boolean(body.periodEnd);
    if (hasStart !== hasEnd) context.addIssue({ code: "custom", message: "بداية ونهاية دورة الفاتورة مطلوبتان معًا" });
    if (hasStart && hasEnd && new Date(body.periodEnd) <= new Date(body.periodStart)) {
      context.addIssue({ code: "custom", message: "نهاية دورة الفاتورة يجب أن تكون بعد بدايتها", path: ["periodEnd"] });
    }
  }),
  billingGenerate: z.object({
    asOf: z.iso.datetime().optional(),
    dueDays: z.number().int().min(1).max(90).default(7),
    reason
  }).strict(),
  device: z.object({
    siteId: z.string().trim().nullable().optional(),
    name: z.string().trim().min(2).max(100),
    branch: z.string().trim().max(100).nullable().optional(),
    host: z.string().trim().min(3).max(253).regex(/^[A-Za-z0-9.:-]+$/),
    apiPort: z.number().int().min(1).max(65535).default(8728),
    connectionMethod: z.enum(["api", "vpn", "agent"]),
    username: z.string().trim().max(100).nullable().optional(),
    secret: z.string().min(8).max(500).nullable().optional()
  }).strict(),
  deviceUpdate: z.object({
    siteId: z.string().trim().nullable().optional(),
    name: z.string().trim().min(2).max(100).optional(),
    branch: z.string().trim().max(100).nullable().optional(),
    host: z.string().trim().min(3).max(253).regex(/^[A-Za-z0-9.:-]+$/).optional(),
    apiPort: z.number().int().min(1).max(65535).optional(),
    connectionMethod: z.enum(["api", "vpn", "agent"]).optional(),
    username: z.string().trim().max(100).nullable().optional(),
    secret: z.string().min(8).max(500).nullable().optional(),
    status: z.enum(["pending", "online", "offline", "error"]).optional(),
    reason
  }).strict().refine((body) => Object.keys(body).some((key) => key !== "reason"), "لا توجد تغييرات"),
  telegram: z.object({
    chatId: z.string().regex(/^-?\d{1,24}$/),
    chatLabel: z.string().trim().min(1).max(100).optional(),
    enabledSeverities: z.array(z.enum(["info", "warning", "critical"])).min(1).default(["warning", "critical"])
  }).strict(),
  siteCreate: z.object({
    name: z.string().trim().min(2).max(100),
    code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/),
    address: optionalText,
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional()
  }).strict(),
  siteUpdate: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/).optional(),
    address: optionalText,
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    reason
  }).strict(),
  poolCreate: z.object({
    siteId: z.string().trim().nullable().optional(),
    name: z.string().trim().min(2).max(100),
    cidr,
    gateway: ipAddress.nullable().optional(),
    dns: z.array(ipAddress).max(4).default([]),
    purpose: z.enum(["pppoe", "hotspot", "static", "management"])
  }).strict(),
  poolUpdate: z.object({
    siteId: z.string().trim().nullable().optional(), name: z.string().trim().min(2).max(100).optional(),
    cidr: cidr.optional(), gateway: ipAddress.nullable().optional(), dns: z.array(ipAddress).max(4).optional(),
    purpose: z.enum(["pppoe", "hotspot", "static", "management"]).optional(),
    status: z.enum(["active", "disabled"]).optional(), reason
  }).strict(),
  policyCreate: z.object({
    name: z.string().trim().min(2).max(100),
    authMethods: z.array(z.enum(["pap", "chap", "mschap", "mschapv2"])).min(1).max(4).default(["pap"]),
    simultaneousUse: z.number().int().min(1).max(100).default(1),
    idleTimeoutSeconds: z.number().int().min(60).max(86400).nullable().optional(),
    sessionTimeoutSeconds: z.number().int().min(300).max(31536000).nullable().optional(),
    interimIntervalSeconds: z.number().int().min(60).max(3600).default(300),
    rateLimitDownMbps: z.number().int().positive().max(100000).nullable().optional(),
    rateLimitUpMbps: z.number().int().positive().max(100000).nullable().optional()
  }).strict(),
  policyUpdate: z.object({
    name: z.string().trim().min(2).max(100).optional(), authMethods: z.array(z.enum(["pap", "chap", "mschap", "mschapv2"])).min(1).max(4).optional(),
    simultaneousUse: z.number().int().min(1).max(100).optional(), idleTimeoutSeconds: z.number().int().min(60).max(86400).nullable().optional(),
    sessionTimeoutSeconds: z.number().int().min(300).max(31536000).nullable().optional(), interimIntervalSeconds: z.number().int().min(60).max(3600).optional(),
    rateLimitDownMbps: z.number().int().positive().max(100000).nullable().optional(), rateLimitUpMbps: z.number().int().positive().max(100000).nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(), reason
  }).strict(),
  resellerCreate: z.object({
    siteId: z.string().trim().nullable().optional(), name: z.string().trim().min(2).max(120), phone: optionalText,
    email: z.email().nullable().optional(), commissionBps: z.number().int().min(0).max(10000).default(0)
  }).strict(),
  resellerUpdate: z.object({
    siteId: z.string().trim().nullable().optional(), name: z.string().trim().min(2).max(120).optional(), phone: optionalText,
    email: z.email().nullable().optional(), commissionBps: z.number().int().min(0).max(10000).optional(),
    status: z.enum(["active", "suspended"]).optional(), reason
  }).strict(),
  voucherBatch: z.object({
    code: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(), planId: nonEmpty,
    resellerId: z.string().trim().nullable().optional(), quantity: z.number().int().min(1).max(250),
    validDays: z.number().int().min(1).max(3650), expiresAt: z.iso.datetime().nullable().optional(),
    usernamePrefix: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9]+$/).optional()
  }).strict(),
  ticketCreate: z.object({
    category: z.enum(["network", "subscriber", "billing", "radius", "other"]),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    title: z.string().trim().min(3).max(160), description: z.string().trim().min(5).max(4000),
    subscriberId: z.string().trim().nullable().optional(), deviceId: z.string().trim().nullable().optional()
  }).strict(),
  ticketMessage: z.object({ body: z.string().trim().min(1).max(4000) }).strict(),
  ticketUpdate: z.object({
    status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    assignedUserId: z.string().trim().nullable().optional(), reason
  }).strict(),
  memberInvite: z.object({
    email: z.email().transform((value) => value.toLowerCase()),
    displayName: z.string().trim().min(2).max(120),
    role: z.enum(["admin", "operator", "collector", "viewer"]),
    reason: z.string().trim().min(3).max(500)
  }).strict(),
  memberUpdate: z.object({
    role: z.enum(["owner", "admin", "operator", "collector", "viewer"]),
    status: z.enum(["active", "invited", "disabled"]),
    reason: z.string().trim().min(3).max(500)
  }).strict(),
  subscriptionSelect: z.object({ productId: nonEmpty }).strict(),
  ownerTenant: z.object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    timeZone: z.string().trim().min(3).max(80),
    ownerEmail: z.email().transform((value) => value.toLowerCase()),
    ownerName: z.string().trim().min(2).max(120),
    productId: nonEmpty,
    reason: z.string().trim().min(5).max(500)
  }).strict(),
  tenantStatus: z.object({ status: z.enum(["active", "suspended"]), reason: z.string().trim().min(5).max(500) }).strict(),
  subscriptionStatus: z.object({
    status: z.enum(["trialing", "active", "grace", "past_due", "canceled", "expired"]),
    productId: z.string().optional(),
    endsAt: z.iso.datetime().nullable().optional(),
    reason: z.string().trim().min(5).max(500)
  }).strict(),
  connectorRotate: z.object({ reason: z.string().trim().min(10).max(500) }).strict(),
  ownerJobRetry: z.object({ reason: z.string().trim().min(5).max(500) }).strict(),
  ownerActivationCode: z.object({
    tenantId: nonEmpty,
    productId: nonEmpty,
    durationDays: z.number().int().min(1).max(3660),
    expiresAt: z.iso.datetime(),
    issuedToName: z.string().trim().min(2).max(120).nullable().optional(),
    issuedToEmail: z.email().transform((value) => value.toLowerCase()).nullable().optional(),
    issuedToPhone: z.string().trim().min(5).max(40).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    reason: z.string().trim().min(5).max(500)
  }).strict().refine((body) => new Date(body.expiresAt).getTime() > Date.now(), "تاريخ انتهاء إدخال الكود يجب أن يكون في المستقبل"),
  installationStatus: z.object({ status: z.enum(["active", "blocked"]), reason: z.string().trim().min(5).max(500) }).strict(),
  radius: z.object({
    eventId: z.string().trim().min(8).max(128),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime(),
    statusType: z.enum(["start", "interim", "stop"]),
    sessionId: z.string().trim().min(1).max(128),
    username: z.string().trim().min(1).max(128),
    nasIp: z.string().trim().max(253).nullable().optional(),
    framedIp: z.string().trim().max(64).nullable().optional(),
    startedAt: z.iso.datetime().nullable().optional(),
    occurredAt: z.iso.datetime(),
    inputBytes: z.number().int().min(0).optional(),
    outputBytes: z.number().int().min(0).optional(),
    terminateCause: z.string().trim().max(120).nullable().optional()
  }).strict(),
  agentClaim: z.object({
    agentId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime()
  }).strict(),
  agentHeartbeat: z.object({
    agentId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime(),
    name: z.string().trim().min(2).max(120),
    siteId: z.string().trim().nullable().optional(),
    role: z.enum(["primary", "replica", "standby"]),
    endpoint: z.string().trim().max(253).nullable().optional(),
    version: z.string().trim().min(1).max(40),
    cachedPrincipals: z.number().int().min(0).max(1_000_000),
    pendingAccounting: z.number().int().min(0).max(1_000_000),
    pendingAuth: z.number().int().min(0).max(1_000_000),
    directorySyncedAt: z.iso.datetime().nullable().optional(),
    lastError: z.string().trim().max(500).nullable().optional()
  }).strict(),
  agentResult: z.object({
    agentId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime(),
    jobId: z.string().trim().min(8).max(128),
    status: z.enum(["succeeded", "failed"]),
    detail: z.string().trim().max(500).nullable().optional()
  }).strict(),
  directory: z.object({
    agentId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime(),
    afterUsername: z.string().trim().max(128).optional(),
    limit: z.number().int().min(1).max(500).optional()
  }).strict(),
  radiusAuthEvent: z.object({
    agentId: z.string().trim().min(3).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    nonce: z.string().trim().min(16).max(128),
    nonceExpiresAt: z.iso.datetime(),
    eventId: z.string().trim().min(8).max(128),
    requestId: z.string().trim().min(1).max(128),
    username: z.string().trim().min(1).max(128),
    principalType: z.enum(["subscriber", "voucher"]).nullable().optional(),
    principalId: z.string().trim().max(128).nullable().optional(),
    nasIp: z.string().trim().max(253).nullable().optional(),
    clientIp: z.string().trim().max(64).nullable().optional(),
    result: z.enum(["accept", "reject", "challenge", "error"]),
    reason: z.string().trim().max(120).nullable().optional(),
    latencyMs: z.number().int().min(0).max(120000).optional(),
    occurredAt: z.iso.datetime()
  }).strict(),
  billing: z.object({
    id: z.string().trim().min(8).max(128),
    type: z.literal("subscription.updated"),
    tenantId: nonEmpty,
    subscriptionId: z.string().optional(),
    externalSubscriptionId: z.string().optional(),
    provider: z.string().trim().min(2).max(50),
    status: z.enum(["trialing", "active", "grace", "past_due", "canceled", "expired"]),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().nullable().optional()
  }).strict()
};

function envelope(data, request, extraMeta = {}) {
  return { data, meta: { requestId: request.id, ...extraMeta } };
}

function parse(schema, body) {
  return schema.parse(body ?? {});
}

function withinDeadline(task, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("readiness check timed out")), milliseconds);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

export async function buildApp({ config, db, platformDb = db, logger = false, fetchImpl = globalThis.fetch } = {}) {
  const app = Fastify({
    logger: logger ? {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.x-uchiha-signature", "body.credential", "body.secret", "body.radiusPassword", "body.password"]
    } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id"
  });

  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, rawBody, done) => {
    request.rawBody = rawBody;
    try {
      done(null, rawBody.length ? JSON.parse(rawBody) : {});
    } catch (error) {
      done(new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "JSON غير صالح"));
    }
  });
  app.addContentTypeParser("*", { parseAs: "string" }, (request, rawBody, done) => {
    request.rawBody = rawBody;
    done(null, rawBody);
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com"],
        frameSrc: ["https://accounts.google.com"],
        connectSrc: ["'self'", "https://accounts.google.com"],
        imgSrc: ["'self'", "data:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new AppError(403, API_ERROR_CODES.FORBIDDEN, "المصدر غير مسموح"), false);
    },
    allowedHeaders: ["authorization", "content-type", "idempotency-key", "x-tenant-id", "x-installation-id", "x-uchiha-platform", "x-request-id", "x-uchiha-timestamp", "x-uchiha-signature"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute", ban: 3 });

  await app.register(fastifyStatic, {
    root: providerRootFor(config.nodeEnv),
    prefix: "/provider/",
    index: ["index.html"],
    wildcard: false
  });
  await app.register(fastifyStatic, {
    root: path.join(projectRoot, "apps/owner-web"),
    prefix: "/owner/",
    index: ["index.html"],
    wildcard: false,
    decorateReply: false
  });

  const googleVerifier = new GoogleIdTokenVerifier({ clientId: config.googleClientId, fetchImpl });
  const authService = new AuthService({ db, config, googleVerifier });
  const provider = new ProviderService({ db, config });
  const operational = new OperationalService({ db, config });
  const billing = new BillingService({ db });
  const owner = new OwnerService(platformDb, config);
  const connector = new ConnectorService({ db, config });
  const platformConnector = new ConnectorService({ db: platformDb, config });
  const idempotency = new IdempotencyService(db);
  const platformIdempotency = new IdempotencyService(platformDb);
  const metrics = new MetricsRegistry();

  app.decorateRequest("authContext", null);
  app.decorateRequest("rawBody", "");
  app.decorateRequest("startedAtNs", 0n);

  app.addHook("onRequest", async (request) => {
    request.startedAtNs = process.hrtime.bigint();
  });
  app.addHook("onResponse", async (request, reply) => {
    const elapsed = Number(process.hrtime.bigint() - request.startedAtNs) / 1_000_000_000;
    metrics.observe({ method: request.method, route: request.routeOptions?.url, statusCode: reply.statusCode, durationSeconds: elapsed });
  });

  async function authenticate(request) {
    const context = await authService.authenticate(bearerToken(request), request.headers["x-tenant-id"] ?? null, request.headers["x-installation-id"] ?? null);
    request.authContext = { ...context, requestId: request.id, ipAddress: request.ip };
  }

  async function idempotent(request, reply, route, statusCode, callback, tenantOverride = null, operationDb = db, idempotencyService = idempotency) {
    const result = await operationDb.withContext(request.authContext, () => idempotencyService.execute({
      tenantId: tenantOverride ?? request.authContext.tenantId ?? `platform:${request.authContext.user.id}`,
      key: request.headers["idempotency-key"], route, body: request.body, statusCode
    }, callback));
    reply.header("idempotency-replayed", String(result.replayed));
    return reply.code(result.statusCode).send(envelope(result.data, request));
  }

  function scoped(request, callback, context = request.authContext, operationDb = db) {
    return operationDb.withContext(context, callback);
  }

  app.get("/", async (_request, reply) => reply.redirect("/provider/"));
  app.get("/health", async (request, reply) => {
    reply.header("cache-control", "no-store");
    return envelope({ status: "ok", version: APP_VERSION, uptimeSeconds: Math.floor(process.uptime()) }, request);
  });
  app.get("/ready", async (request, reply) => {
    try {
      const runtimeCheck = db.withContext({ tenantId: "" }, async () => {
        await db.get("SELECT 1 AS ok");
        await db.get("SELECT period_start FROM invoices LIMIT 0");
        await db.get("SELECT resolved_at FROM alerts LIMIT 0");
        await db.get("SELECT id FROM radius_nodes LIMIT 0");
        await db.get("SELECT installation_hash FROM app_installations LIMIT 0");
        await db.get("SELECT code_hash FROM activation_codes LIMIT 0");
      });
      const platformCheck = platformDb === db ? Promise.resolve() : platformDb.withContext({ tenantId: "", platformAccess: true }, async () => {
        await platformDb.get("SELECT 1 AS ok");
        await platformDb.get("SELECT payload_hash FROM webhook_events LIMIT 0");
        await platformDb.get("SELECT id FROM outbox LIMIT 0");
      });
      await withinDeadline(Promise.all([runtimeCheck, platformCheck]), 3_000);
      reply.header("cache-control", "no-store");
      return envelope({ ready: true }, request);
    } catch {
      reply.header("cache-control", "no-store");
      return reply.code(503).send(envelope({ ready: false }, request));
    }
  });
  app.get("/metrics", async (request, reply) => {
    const token = bearerToken(request);
    if (!config.metricsToken || !safeEqual(token ?? "", config.metricsToken)) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "بيانات مراقبة غير صالحة");
    }
    const operationalMetrics = await platformDb.withContext({ tenantId: "", platformAccess: true }, async () => {
      const staleBefore = new Date(Date.now() - 90_000).toISOString();
      const [pending, failed, sessions, alerts, nodes] = await Promise.all([
        platformDb.get("SELECT COUNT(*) AS total FROM outbox WHERE status = 'pending'"),
        platformDb.get("SELECT COUNT(*) AS total FROM outbox WHERE status = 'failed'"),
        platformDb.get("SELECT COUNT(*) AS total FROM radius_sessions WHERE status = 'active'"),
        platformDb.get("SELECT COUNT(*) AS total FROM alerts WHERE status = 'open' AND severity = 'critical'"),
        platformDb.get("SELECT COUNT(*) AS total FROM radius_nodes WHERE status <> 'healthy' OR last_seen_at < ?", [staleBefore])
      ]);
      return { pendingJobs: pending?.total, failedJobs: failed?.total, activeSessions: sessions?.total,
        openCriticalAlerts: alerts?.total, unhealthyNodes: nodes?.total };
    });
    return reply.header("cache-control", "no-store").type("text/plain; version=0.0.4; charset=utf-8").send(metrics.render(operationalMetrics));
  });
  app.get("/api/v1/meta", async (request) => envelope({
    product: "UCHIHA RADIUS",
    version: APP_VERSION,
    googleClientId: config.googleClientId && !config.googleClientId.startsWith("replace-") ? config.googleClientId : null,
    billingCheckoutAvailable: Boolean(config.billingCheckoutEndpoint),
    activationWhatsappNumber: "963942586044",
    installationBindingRequired: Boolean(config.requireInstallationBinding),
    devAuthAvailable: config.allowDevAuth
  }, request));

  app.post("/api/v1/auth/google", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(schemas.googleLogin, request.body);
    const result = await authService.loginGoogle(body.credential, { userAgent: request.headers["user-agent"], ipAddress: request.ip,
      installationId: request.headers["x-installation-id"] ?? null, platform: request.headers["x-uchiha-platform"] === "android" ? "android" : "web" });
    return reply.code(200).send(envelope(result, request));
  });
  app.post("/api/v1/auth/dev", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = parse(schemas.devLogin, request.body);
    const result = await authService.loginDev(body.mode, { userAgent: request.headers["user-agent"], ipAddress: request.ip,
      installationId: request.headers["x-installation-id"] ?? null, platform: request.headers["x-uchiha-platform"] === "android" ? "android" : "web" });
    return reply.send(envelope(result, request));
  });
  app.get("/api/v1/auth/me", { preHandler: authenticate }, async (request) => envelope(request.authContext, request));
  app.post("/api/v1/auth/logout", { preHandler: authenticate }, async (request) => {
    await authService.logout(request.authContext.sessionId);
    return envelope({ loggedOut: true }, request);
  });

  app.post("/api/v1/subscriptions/redeem", { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.activationRedeem, request.body);
    return idempotent(request, reply, "POST:/subscriptions/redeem", 200,
      (tx) => provider.redeemActivationCode(request.authContext, body.activationCode, tx));
  });

  app.get("/api/v1/dashboard", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.dashboard(request.authContext)), request));
  app.get("/api/v1/subscribers", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listSubscribers(request.authContext, request.query)), request));
  app.get("/api/v1/subscribers/:id", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.getSubscriber(request.authContext, request.params.id)), request));
  app.post("/api/v1/subscribers", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.subscriberCreate, request.body);
    return idempotent(request, reply, "POST:/subscribers", 201, (tx) => provider.createSubscriber(request.authContext, body, tx));
  });
  app.patch("/api/v1/subscribers/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.subscriberUpdate, request.body);
    return idempotent(request, reply, `PATCH:/subscribers/${request.params.id}`, 200, (tx) => provider.updateSubscriber(request.authContext, request.params.id, body, tx));
  });
  app.put("/api/v1/subscribers/:id/credential", { preHandler: authenticate, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.subscriberCredential, request.body);
    return idempotent(request, reply, `PUT:/subscribers/${request.params.id}/credential`, 200,
      (tx) => provider.setSubscriberCredential(request.authContext, request.params.id, body.radiusPassword, body.reason, tx));
  });
  app.post("/api/v1/subscribers/:id/suspend", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/subscribers/${request.params.id}/suspend`, 202, (tx) => provider.setSubscriberStatus(request.authContext, request.params.id, "suspended", body.reason, tx));
  });
  app.post("/api/v1/subscribers/:id/activate", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/subscribers/${request.params.id}/activate`, 202, (tx) => provider.setSubscriberStatus(request.authContext, request.params.id, "active", body.reason, tx));
  });
  app.post("/api/v1/subscribers/:id/renew", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.subscriberRenew, request.body);
    return idempotent(request, reply, `POST:/subscribers/${request.params.id}/renew`, 200,
      (tx) => provider.renewSubscriber(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/plans", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listPlans(request.authContext)), request));
  app.post("/api/v1/plans", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.planCreate, request.body);
    return idempotent(request, reply, "POST:/plans", 201, (tx) => provider.createPlan(request.authContext, body, tx));
  });
  app.patch("/api/v1/plans/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.planUpdate, request.body);
    return idempotent(request, reply, `PATCH:/plans/${request.params.id}`, 200,
      (tx) => provider.updatePlan(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/sessions", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listSessions(request.authContext, request.query)), request));
  app.post("/api/v1/sessions/:id/disconnect", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/sessions/${request.params.id}/disconnect`, 202, (tx) => provider.disconnectSession(request.authContext, request.params.id, body.reason, tx));
  });

  app.get("/api/v1/invoices", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listInvoices(request.authContext, request.query)), request));
  app.get("/api/v1/payments", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => billing.listPayments(request.authContext, request.query)), request));
  app.post("/api/v1/invoices", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.invoiceCreate, request.body);
    return idempotent(request, reply, "POST:/invoices", 201, (tx) => billing.createInvoice(request.authContext, body, tx));
  });
  app.post("/api/v1/invoices/:id/payments", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.payment, request.body);
    return idempotent(request, reply, `POST:/invoices/${request.params.id}/payments`, 201, (tx) => provider.recordPayment(request.authContext, request.params.id, body, tx));
  });
  app.post("/api/v1/invoices/:id/void", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/invoices/${request.params.id}/void`, 200,
      (tx) => billing.voidInvoice(request.authContext, request.params.id, body.reason, tx));
  });
  app.post("/api/v1/billing/generate", { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.billingGenerate, request.body);
    return idempotent(request, reply, "POST:/billing/generate", 200, (tx) => billing.generate(request.authContext, body, tx));
  });

  app.get("/api/v1/devices", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listDevices(request.authContext)), request));
  app.post("/api/v1/devices", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.device, request.body);
    return idempotent(request, reply, "POST:/devices", 201, (tx) => provider.createDevice(request.authContext, body, tx));
  });
  app.patch("/api/v1/devices/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.deviceUpdate, request.body);
    return idempotent(request, reply, `PATCH:/devices/${request.params.id}`, 200,
      (tx) => provider.updateDevice(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/sites", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listSites(request.authContext)), request));
  app.post("/api/v1/sites", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.siteCreate, request.body);
    return idempotent(request, reply, "POST:/sites", 201, (tx) => operational.createSite(request.authContext, body, tx));
  });
  app.patch("/api/v1/sites/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.siteUpdate, request.body);
    return idempotent(request, reply, `PATCH:/sites/${request.params.id}`, 200, (tx) => operational.updateSite(request.authContext, request.params.id, body, tx));
  });
  app.get("/api/v1/topology", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.topology(request.authContext)), request));

  app.get("/api/v1/ip-pools", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listPools(request.authContext)), request));
  app.post("/api/v1/ip-pools", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.poolCreate, request.body);
    return idempotent(request, reply, "POST:/ip-pools", 201, (tx) => operational.createPool(request.authContext, body, tx));
  });
  app.patch("/api/v1/ip-pools/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.poolUpdate, request.body);
    return idempotent(request, reply, `PATCH:/ip-pools/${request.params.id}`, 200, (tx) => operational.updatePool(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/radius/policies", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listPolicies(request.authContext)), request));
  app.post("/api/v1/radius/policies", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.policyCreate, request.body);
    return idempotent(request, reply, "POST:/radius/policies", 201, (tx) => operational.createPolicy(request.authContext, body, tx));
  });
  app.patch("/api/v1/radius/policies/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.policyUpdate, request.body);
    return idempotent(request, reply, `PATCH:/radius/policies/${request.params.id}`, 200, (tx) => operational.updatePolicy(request.authContext, request.params.id, body, tx));
  });
  app.get("/api/v1/radius/overview", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.radiusOverview(request.authContext)), request));
  app.get("/api/v1/radius/auth-events", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listAuthEvents(request.authContext, request.query)), request));
  app.get("/api/v1/radius/accounting-events", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listAccountingEvents(request.authContext, request.query)), request));
  app.get("/api/v1/radius/nodes", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.radiusNodes(request.authContext)), request));

  app.get("/api/v1/resellers", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listResellers(request.authContext)), request));
  app.post("/api/v1/resellers", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.resellerCreate, request.body);
    return idempotent(request, reply, "POST:/resellers", 201, (tx) => operational.createReseller(request.authContext, body, tx));
  });
  app.patch("/api/v1/resellers/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.resellerUpdate, request.body);
    return idempotent(request, reply, `PATCH:/resellers/${request.params.id}`, 200, (tx) => operational.updateReseller(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/voucher-batches", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listVoucherBatches(request.authContext, request.query)), request));
  app.get("/api/v1/voucher-batches/:id", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.voucherBatch(request.authContext, request.params.id)), request));
  app.post("/api/v1/voucher-batches", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.voucherBatch, request.body);
    return idempotent(request, reply, "POST:/voucher-batches", 201, (tx) => operational.createVoucherBatch(request.authContext, body, tx));
  });
  app.post("/api/v1/voucher-batches/:id/export", { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    const data = await scoped(request, () => db.transaction((tx) => operational.exportVoucherBatch(request.authContext, request.params.id, body.reason, tx)));
    return reply.header("cache-control", "no-store, max-age=0").header("pragma", "no-cache").send(envelope(data, request));
  });
  app.post("/api/v1/vouchers/:id/revoke", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/vouchers/${request.params.id}/revoke`, 200, (tx) => operational.revokeVoucher(request.authContext, request.params.id, body.reason, tx));
  });

  app.get("/api/v1/support/tickets", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.listTickets(request.authContext, request.query)), request));
  app.get("/api/v1/support/tickets/:id", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.ticket(request.authContext, request.params.id)), request));
  app.post("/api/v1/support/tickets", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.ticketCreate, request.body);
    return idempotent(request, reply, "POST:/support/tickets", 201, (tx) => operational.createTicket(request.authContext, body, tx));
  });
  app.post("/api/v1/support/tickets/:id/messages", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.ticketMessage, request.body);
    return idempotent(request, reply, `POST:/support/tickets/${request.params.id}/messages`, 201,
      (tx) => operational.addTicketMessage(request.authContext, request.params.id, body.body, tx));
  });
  app.patch("/api/v1/support/tickets/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.ticketUpdate, request.body);
    return idempotent(request, reply, `PATCH:/support/tickets/${request.params.id}`, 200,
      (tx) => operational.updateTicket(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/integrations", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.integrations(request.authContext)), request));
  app.get("/api/v1/reports/summary", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => operational.reports(request.authContext, request.query)), request));

  app.get("/api/v1/alerts", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listAlerts(request.authContext, request.query)), request));
  app.post("/api/v1/alerts/:id/acknowledge", { preHandler: authenticate }, async (request, reply) =>
    idempotent(request, reply, `POST:/alerts/${request.params.id}/acknowledge`, 200, (tx) => provider.acknowledgeAlert(request.authContext, request.params.id, tx)));
  app.post("/api/v1/alerts/:id/resolve", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/alerts/${request.params.id}/resolve`, 200,
      (tx) => provider.resolveAlert(request.authContext, request.params.id, body.reason, tx));
  });
  app.get("/api/v1/audit", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listAudit(request.authContext, request.query)), request));

  app.get("/api/v1/subscriptions/products", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.subscriptionProducts(request.authContext)), request));
  app.get("/api/v1/subscriptions/requests/:id", { preHandler: authenticate }, async (request) =>
    envelope(await scoped(request, () => provider.subscriptionRequest(request.authContext, request.params.id)), request));
  app.post("/api/v1/subscriptions/select", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.subscriptionSelect, request.body);
    return idempotent(request, reply, "POST:/subscriptions/select", 202, (tx) => provider.selectSubscription(request.authContext, body.productId, tx));
  });

  app.get("/api/v1/integrations/telegram", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.telegramIntegration(request.authContext)), request));
  app.put("/api/v1/integrations/telegram", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.telegram, request.body);
    return idempotent(request, reply, "PUT:/integrations/telegram", 200, (tx) => provider.configureTelegram(request.authContext, body, tx));
  });
  app.post("/api/v1/integrations/telegram/test", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, "POST:/integrations/telegram/test", 202,
      (tx) => provider.testTelegram(request.authContext, body.reason, tx));
  });
  app.post("/api/v1/integrations/telegram/disable", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, "POST:/integrations/telegram/disable", 200,
      (tx) => provider.disableTelegram(request.authContext, body.reason, tx));
  });
  app.get("/api/v1/team", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => provider.listMembers(request.authContext)), request));
  app.post("/api/v1/team/invitations", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.memberInvite, request.body);
    return idempotent(request, reply, "POST:/team/invitations", 201, (tx) => provider.inviteMember(request.authContext, body, tx));
  });
  app.patch("/api/v1/team/:id", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.memberUpdate, request.body);
    return idempotent(request, reply, `PATCH:/team/${request.params.id}`, 200, (tx) => provider.updateMember(request.authContext, request.params.id, body, tx));
  });

  app.get("/api/v1/owner/overview", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => owner.overview(request.authContext), request.authContext, platformDb), request));
  app.get("/api/v1/owner/products", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => owner.products(request.authContext), request.authContext, platformDb), request));
  app.get("/api/v1/owner/tenants", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => owner.listTenants(request.authContext, request.query), request.authContext, platformDb), request));
  app.get("/api/v1/owner/tenants/:id", { preHandler: authenticate }, async (request) => envelope(await scoped(request,
    () => owner.tenant(request.authContext, request.params.id), request.authContext, platformDb), request));
  app.post("/api/v1/owner/tenants", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.ownerTenant, request.body);
    return idempotent(request, reply, "POST:/owner/tenants", 201, (tx) => owner.createTenant(request.authContext, body, tx), null, platformDb, platformIdempotency);
  });
  app.post("/api/v1/owner/tenants/:id/status", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.tenantStatus, request.body);
    return idempotent(request, reply, `POST:/owner/tenants/${request.params.id}/status`, 200,
      (tx) => owner.setTenantStatus(request.authContext, request.params.id, body.status, body.reason, tx), request.params.id, platformDb, platformIdempotency);
  });
  app.post("/api/v1/owner/tenants/:id/subscription", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.subscriptionStatus, request.body);
    return idempotent(request, reply, `POST:/owner/tenants/${request.params.id}/subscription`, 200,
      (tx) => owner.setSubscriptionStatus(request.authContext, request.params.id, body, tx), request.params.id, platformDb, platformIdempotency);
  });
  app.post("/api/v1/owner/tenants/:id/radius-credential", { preHandler: authenticate, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.connectorRotate, request.body);
    return idempotent(request, reply, `POST:/owner/tenants/${request.params.id}/radius-credential`, 200,
      (tx) => owner.rotateRadiusCredential(request.authContext, request.params.id, body.reason, tx), request.params.id, platformDb, platformIdempotency);
  });
  app.get("/api/v1/owner/activation-codes", { preHandler: authenticate }, async (request) =>
    envelope(await scoped(request, () => owner.listActivationCodes(request.authContext, request.query), request.authContext, platformDb), request));
  app.post("/api/v1/owner/activation-codes", { preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request, reply) => {
    const body = parse(schemas.ownerActivationCode, request.body);
    return idempotent(request, reply, "POST:/owner/activation-codes", 201,
      (tx) => owner.createActivationCode(request.authContext, body, tx), body.tenantId, platformDb, platformIdempotency);
  });
  app.post("/api/v1/owner/activation-codes/:id/revoke", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.statusReason, request.body);
    return idempotent(request, reply, `POST:/owner/activation-codes/${request.params.id}/revoke`, 200,
      (tx) => owner.revokeActivationCode(request.authContext, request.params.id, body.reason, tx), null, platformDb, platformIdempotency);
  });
  app.get("/api/v1/owner/installations", { preHandler: authenticate }, async (request) =>
    envelope(await scoped(request, () => owner.listInstallations(request.authContext, request.query), request.authContext, platformDb), request));
  app.post("/api/v1/owner/installations/:id/status", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.installationStatus, request.body);
    return idempotent(request, reply, `POST:/owner/installations/${request.params.id}/status`, 200,
      (tx) => owner.setInstallationStatus(request.authContext, request.params.id, body.status, body.reason, tx), null, platformDb, platformIdempotency);
  });
  app.get("/api/v1/owner/audit", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => owner.audit(request.authContext, request.query), request.authContext, platformDb), request));
  app.get("/api/v1/owner/jobs", { preHandler: authenticate }, async (request) => envelope(await scoped(request, () => owner.jobs(request.authContext, request.query), request.authContext, platformDb), request));
  app.post("/api/v1/owner/jobs/:id/retry", { preHandler: authenticate }, async (request, reply) => {
    const body = parse(schemas.ownerJobRetry, request.body);
    return idempotent(request, reply, `POST:/owner/jobs/${request.params.id}/retry`, 200,
      (tx) => owner.retryJob(request.authContext, request.params.id, body.reason, tx), null, platformDb, platformIdempotency);
  });

  app.post("/connectors/radius/:tenantSlug/accounting", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (request, reply) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    const timestamp = request.headers["x-uchiha-timestamp"];
    const signature = request.headers["x-uchiha-signature"];
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp, rawBody: request.rawBody, signature }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.radius, request.body);
    const result = await scoped(request, () => connector.radiusAccounting(tenant, body), { tenantId: tenant.id });
    return reply.code(202).send(envelope(result, request));
  });

  app.post("/connectors/radius/:tenantSlug/directory", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp: request.headers["x-uchiha-timestamp"], rawBody: request.rawBody, signature: request.headers["x-uchiha-signature"] }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.directory, request.body);
    const data = await scoped(request, () => connector.radiusDirectory(tenant, body), { tenantId: tenant.id });
    return reply.header("cache-control", "no-store, max-age=0").header("pragma", "no-cache").send(envelope(data, request));
  });

  app.post("/connectors/radius/:tenantSlug/auth-events", { config: { rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (request, reply) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp: request.headers["x-uchiha-timestamp"], rawBody: request.rawBody, signature: request.headers["x-uchiha-signature"] }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.radiusAuthEvent, request.body);
    return reply.code(202).send(envelope(await scoped(request, () => connector.radiusAuthEvent(tenant, body), { tenantId: tenant.id }), request));
  });

  app.post("/connectors/radius/:tenantSlug/heartbeat", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp: request.headers["x-uchiha-timestamp"], rawBody: request.rawBody, signature: request.headers["x-uchiha-signature"] }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.agentHeartbeat, request.body);
    return envelope(await scoped(request, () => connector.radiusHeartbeat(tenant, body), { tenantId: tenant.id }), request);
  });

  app.post("/connectors/radius/:tenantSlug/commands/claim", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp: request.headers["x-uchiha-timestamp"], rawBody: request.rawBody, signature: request.headers["x-uchiha-signature"] }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.agentClaim, request.body);
    return envelope(await scoped(request, () => connector.claimRadiusCommand(tenant, body), { tenantId: tenant.id }), request);
  });

  app.post("/connectors/radius/:tenantSlug/commands/result", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const tenant = await connector.tenantBySlug(request.params.tenantSlug);
    if (!await scoped(request, () => connector.verifyRadiusSignature(tenant.id, { timestamp: request.headers["x-uchiha-timestamp"], rawBody: request.rawBody, signature: request.headers["x-uchiha-signature"] }), { tenantId: tenant.id })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الموصل غير صالح");
    }
    const body = parse(schemas.agentResult, request.body);
    return envelope(await scoped(request, () => connector.completeRadiusCommand(tenant, body), { tenantId: tenant.id }), request);
  });

  app.post("/webhooks/billing", async (request, reply) => {
    const timestamp = request.headers["x-uchiha-timestamp"];
    const signature = request.headers["x-uchiha-signature"];
    if (!verifySignedPayload({ secret: config.billingWebhookSecret, timestamp, rawBody: request.rawBody, signature })) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "توقيع الدفع غير صالح");
    }
    const body = parse(schemas.billing, request.body);
    return reply.code(202).send(envelope(await scoped(request, () => connector.billingEvent(body), { tenantId: body.tenantId }), request));
  });

  app.post("/webhooks/telegram", async (request, reply) => {
    const secret = request.headers["x-telegram-bot-api-secret-token"] ?? "";
    if (!config.telegramWebhookSecret || !safeEqual(secret, config.telegramWebhookSecret)) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "Webhook Telegram غير صالح");
    }
    return reply.code(202).send(envelope(await scoped(request, () => platformConnector.telegramUpdate(request.body), request.authContext, platformDb), request));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: API_ERROR_CODES.VALIDATION_ERROR, message: "تحقق من الحقول المدخلة", details: error.issues }, meta: { requestId: request.id } });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details }, meta: { requestId: request.id } });
    }
    if (error?.code === "SQLITE_CONSTRAINT_UNIQUE" || error?.code === "23505") {
      return reply.code(409).send({ error: { code: API_ERROR_CODES.CONFLICT, message: "القيمة مستخدمة مسبقًا" }, meta: { requestId: request.id } });
    }
    request.log?.error?.({ err: error }, "unhandled request error");
    return reply.code(500).send({ error: { code: API_ERROR_CODES.INTERNAL_ERROR, message: "حدث خطأ داخلي" }, meta: { requestId: request.id } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/webhooks/") || request.url.startsWith("/connectors/")) {
      return reply.code(404).send({ error: { code: API_ERROR_CODES.NOT_FOUND, message: "المسار غير موجود" }, meta: { requestId: request.id } });
    }
    return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
  });

  return app;
}
