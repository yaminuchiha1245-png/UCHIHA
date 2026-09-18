const TOKEN_KEY = "uchiha_radius_owner_session";
const configuredApiBase = document.querySelector('meta[name="uchiha-api-base"]')?.content?.replace(/\/$/, "") ?? "";
const apiPrefix = configuredApiBase ? `${configuredApiBase}/api/v1` : "/api/v1";
let memoryToken = null;
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

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

export const session = {
  get token() { try { return sessionStorage.getItem(TOKEN_KEY) ?? memoryToken; } catch { return memoryToken; } },
  set token(value) { memoryToken = value || null; try { value ? sessionStorage.setItem(TOKEN_KEY, value) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* Local preview may block storage. */ } },
  clear() { this.token = null; for (const controller of activeRequests) controller.abort(); activeRequests.clear(); uncertainWrites.clear(); }
};

export async function request(path, options = {}) {
  const controller = new AbortController();
  if (!options.preserveOnLogout) activeRequests.add(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 12_000);
  const headers = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.auth !== false && session.token) headers.authorization = `Bearer ${session.token}`;
  const writeSignature = options.idempotent ? JSON.stringify([session.token, path, options.method, options.body]) : null;
  if (writeSignature) {
    const key = options.key ?? uncertainWrites.get(writeSignature) ?? idempotencyKey();
    uncertainWrites.set(writeSignature, key); headers["idempotency-key"] = key;
  }
  try {
    const response = await fetch(`${apiPrefix}${path}`, { method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal });
    const payload = await response.json();
    if (writeSignature && (response.ok || (response.status < 500 && ![408, 409, 429].includes(response.status)))) uncertainWrites.delete(writeSignature);
    if (!response.ok) throw new ApiError(response.status, payload.error?.code ?? "HTTP_ERROR", payload.error?.message ?? "تعذر إكمال الطلب", payload.error?.details);
    return payload.data;
  } catch (error) {
    if (error.name === "AbortError") throw new ApiError(408, "TIMEOUT", "استغرق الاتصال وقتًا أطول من المتوقع");
    throw error;
  } finally { clearTimeout(timer); activeRequests.delete(controller); options.signal?.removeEventListener("abort", abort); }
}

export const api = {
  meta: () => request("/meta", { auth: false }),
  devLogin: () => request("/auth/dev", { method: "POST", body: { mode: "owner" }, auth: false }),
  googleLogin: (credential) => request("/auth/google", { method: "POST", body: { credential }, auth: false }),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST", preserveOnLogout: true }),
  overview: () => request("/owner/overview"),
  tenants: (query = "") => request(`/owner/tenants${query}`),
  tenant: (id) => request(`/owner/tenants/${id}`),
  createTenant: (body) => request("/owner/tenants", { method: "POST", body, idempotent: true }),
  tenantStatus: (id, body) => request(`/owner/tenants/${id}/status`, { method: "POST", body, idempotent: true }),
  subscriptionStatus: (id, body) => request(`/owner/tenants/${id}/subscription`, { method: "POST", body, idempotent: true }),
  rotateRadiusCredential: (id, body) => request(`/owner/tenants/${id}/radius-credential`, { method: "POST", body, idempotent: true }),
  audit: (query = "") => request(`/owner/audit${query}`),
  jobs: (query = "") => request(`/owner/jobs${query}`),
  retryJob: (id, body) => request(`/owner/jobs/${id}/retry`, { method: "POST", body, idempotent: true }),
  products: async () => ({ products: (await request("/owner/products")).items })
};
