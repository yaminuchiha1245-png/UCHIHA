const TOKEN_KEY = "uchiha_radius_session";
const TENANT_KEY = "uchiha_radius_tenant";
const configuredApiBase = document.querySelector('meta[name="uchiha-api-base"]')?.content?.replace(/\/$/, "") ?? "";
const apiPrefix = configuredApiBase ? `${configuredApiBase}/api/v1` : "/api/v1";
const sessionMemory = new Map();
const activeRequests = new Set();
const uncertainWrites = new Map();

// Local-file Android previews may expose getRandomValues without randomUUID.
function idempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readSessionValue(key) {
  try { return sessionStorage.getItem(key) ?? sessionMemory.get(key) ?? null; }
  catch { return sessionMemory.get(key) ?? null; }
}

function writeSessionValue(key, value) {
  if (value) sessionMemory.set(key, value); else sessionMemory.delete(key);
  try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); }
  catch { /* Sandboxed and local-file previews can deny sessionStorage. */ }
}

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const session = {
  get token() { return readSessionValue(TOKEN_KEY); },
  set token(value) { writeSessionValue(TOKEN_KEY, value); },
  get tenantId() { return readSessionValue(TENANT_KEY); },
  set tenantId(value) { writeSessionValue(TENANT_KEY, value); },
  clear() {
    writeSessionValue(TOKEN_KEY, null); writeSessionValue(TENANT_KEY, null);
    for (const controller of activeRequests) controller.abort();
    activeRequests.clear(); uncertainWrites.clear();
  }
};

export async function request(path, options = {}) {
  const controller = new AbortController();
  if (!options.preserveOnLogout) activeRequests.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), options.timeout ?? 12_000);
  const headers = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.auth !== false && session.token) headers.authorization = `Bearer ${session.token}`;
  if (options.auth !== false && session.tenantId) headers["x-tenant-id"] = session.tenantId;
  const writeSignature = options.idempotent ? JSON.stringify([session.token, session.tenantId, path, options.method, options.body]) : null;
  if (writeSignature) {
    const key = options.idempotencyKey ?? uncertainWrites.get(writeSignature) ?? idempotencyKey();
    uncertainWrites.set(writeSignature, key);
    headers["idempotency-key"] = key;
  }
  try {
    const response = await fetch(`${apiPrefix}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
    const payload = await response.json();
    if (writeSignature && (response.ok || (response.status < 500 && ![408, 409, 429].includes(response.status)))) uncertainWrites.delete(writeSignature);
    if (!response.ok) throw new ApiError(response.status, payload.error?.code ?? "HTTP_ERROR", payload.error?.message ?? "تعذر إكمال الطلب", payload.error?.details);
    return payload.data;
  } catch (error) {
    if (error.name === "AbortError") throw new ApiError(408, "TIMEOUT", "استغرق الاتصال وقتًا أطول من المتوقع");
    throw error;
  } finally {
    clearTimeout(timeout);
    activeRequests.delete(controller);
    options.signal?.removeEventListener("abort", abort);
  }
}

export const api = {
  meta: () => request("/meta", { auth: false }),
  devLogin: (mode) => request("/auth/dev", { method: "POST", body: { mode }, auth: false }),
  googleLogin: (credential) => request("/auth/google", { method: "POST", body: { credential }, auth: false }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST", preserveOnLogout: true }),
  dashboard: () => request("/dashboard"),
  subscribers: (query = "") => request(`/subscribers${query}`),
  subscriber: (id) => request(`/subscribers/${id}`),
  createSubscriber: (body) => request("/subscribers", { method: "POST", body, idempotent: true }),
  updateSubscriber: (id, body) => request(`/subscribers/${id}`, { method: "PATCH", body, idempotent: true }),
  subscriberStatus: (id, action, reason) => request(`/subscribers/${id}/${action}`, { method: "POST", body: { reason }, idempotent: true }),
  plans: () => request("/plans"),
  createPlan: (body) => request("/plans", { method: "POST", body, idempotent: true }),
  sessions: (query = "") => request(`/sessions${query}`),
  disconnect: (id, reason) => request(`/sessions/${id}/disconnect`, { method: "POST", body: { reason }, idempotent: true }),
  invoices: (query = "") => request(`/invoices${query}`),
  payment: (id, body) => request(`/invoices/${id}/payments`, { method: "POST", body, idempotent: true }),
  devices: () => request("/devices"),
  createDevice: (body) => request("/devices", { method: "POST", body, idempotent: true }),
  alerts: () => request("/alerts"),
  acknowledgeAlert: (id) => request(`/alerts/${id}/acknowledge`, { method: "POST", body: {}, idempotent: true }),
  audit: (query = "") => request(`/audit${query}`),
  products: () => request("/subscriptions/products"),
  subscriptionRequest: (id) => request(`/subscriptions/requests/${id}`),
  selectSubscription: (productId) => request("/subscriptions/select", { method: "POST", body: { productId }, idempotent: true }),
  telegram: () => request("/integrations/telegram"),
  configureTelegram: (body) => request("/integrations/telegram", { method: "PUT", body, idempotent: true })
  ,team: () => request("/team")
  ,inviteMember: (body) => request("/team/invitations", { method: "POST", body, idempotent: true })
  ,updateMember: (id, body) => request(`/team/${id}`, { method: "PATCH", body, idempotent: true })
};
