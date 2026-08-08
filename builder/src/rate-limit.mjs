function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clientAddress(request) {
  return String(request.ip || request.headers["x-forwarded-for"] || "unknown")
    .split(",")[0]
    .trim();
}

function matchingPolicy(request, policies) {
  const pathname = String(request.raw?.url || request.url || "").split("?")[0];
  return policies.find((policy) => {
    if (policy.method && request.method !== policy.method) return false;
    return typeof policy.match === "function" ? policy.match(pathname, request) : policy.match.test(pathname);
  });
}

export function createRateLimitHook(config, { now = () => Date.now() } = {}) {
  const buckets = new Map();
  const windowMs = positiveInteger(config.rateLimitWindowMs, 60_000);
  const policies = [
    {
      name: "authentication",
      method: "POST",
      match: /^\/api\/(?:auth|customer\/stores\/[^/]+\/auth)\/(?:register|login)$/,
      maximum: positiveInteger(config.authRateLimitMax, 12)
    },
    {
      name: "financial_write",
      match: (pathname, request) =>
        request.method !== "GET" &&
        request.method !== "HEAD" &&
        (/^\/api\/public\/stores\/[^/]+\/(?:deposits|orders\/wallet)$/.test(pathname) ||
          /^\/api\/storefront\/[^/]+\/orders$/.test(pathname) ||
          /^\/api\/platform\/ai-bots\/purchase$/.test(pathname)),
      maximum: positiveInteger(config.purchaseRateLimitMax, 30)
    },
    {
      name: "public_service_request",
      method: "POST",
      match: /^\/api\/public\/service-requests$/,
      maximum: positiveInteger(config.purchaseRateLimitMax, 30)
    },
    {
      name: "provider_webhook",
      method: "POST",
      match: /^\/webhooks\/providers\/[0-9a-f-]+$/i,
      maximum: positiveInteger(config.webhookRateLimitMax, 120)
    },
    {
      name: "ai_bot_webhook",
      method: "POST",
      match: /^\/webhooks\/ai-bots\/[0-9a-f-]+$/i,
      maximum: Math.max(600, positiveInteger(config.webhookRateLimitMax, 120) * 5),
      key: (pathname, request) => `${pathname}:${clientAddress(request)}`
    }
  ];

  function prune(timestamp) {
    if (buckets.size < 2_000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(key);
    }
  }

  return async function rateLimitHook(request, reply) {
    if (!config.rateLimitEnabled) return;
    const policy = matchingPolicy(request, policies);
    if (!policy) return;
    const timestamp = now();
    prune(timestamp);
    const pathname = String(request.raw?.url || request.url || "").split("?")[0];
    const discriminator = typeof policy.key === "function"
      ? policy.key(pathname, request)
      : clientAddress(request);
    const key = `${policy.name}:${discriminator}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, policy.maximum - bucket.count);
    reply.header("x-ratelimit-limit", String(policy.maximum));
    reply.header("x-ratelimit-remaining", String(remaining));
    reply.header("x-ratelimit-reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > policy.maximum) {
      reply.header("retry-after", String(Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))));
      const error = new Error("تم إرسال طلبات كثيرة. حاول مرة أخرى بعد قليل.");
      error.statusCode = 429;
      error.code = "rate_limit_exceeded";
      throw error;
    }
  };
}