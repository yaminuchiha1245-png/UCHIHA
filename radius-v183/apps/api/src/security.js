import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature
} from "node:crypto";
import { AppError } from "./errors.js";
import { API_ERROR_CODES } from "@uchiha-radius/contracts";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const ACTIVATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeInstallationId(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "معرّف تثبيت التطبيق غير صالح");
  }
  return normalized;
}

export function hashInstallationId(value) {
  return sha256(`uchiha-installation:v1:${normalizeInstallationId(value)}`);
}

export function installationHint(value) {
  const normalized = normalizeInstallationId(value);
  return `${normalized.slice(0, 8)}…${normalized.slice(-4)}`;
}

export function normalizeActivationCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  if (!/^UCHI(?:-[A-HJ-NP-Z2-9]{4}){4}$/.test(normalized)) {
    throw new AppError(400, API_ERROR_CODES.VALIDATION_ERROR, "صيغة كود التفعيل غير صالحة");
  }
  return normalized;
}

export function hashActivationCode(value) {
  return sha256(`uchiha-activation:v1:${normalizeActivationCode(value)}`);
}

export function activationCodeHint(value) {
  const normalized = normalizeActivationCode(value);
  return `UCHI-••••-••••-••••-${normalized.slice(-4)}`;
}

export function createActivationCode() {
  const bytes = randomBytes(16);
  const groups = [];
  for (let group = 0; group < 4; group += 1) {
    let part = "";
    for (let index = 0; index < 4; index += 1) part += ACTIVATION_ALPHABET[bytes[group * 4 + index] % ACTIVATION_ALPHABET.length];
    groups.push(part);
  }
  return `UCHI-${groups.join("-")}`;
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function encryptionKeyFromConfig(value) {
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (process.env.NODE_ENV === "production") throw new Error("A valid APP_ENCRYPTION_KEY is required");
  return createHash("sha256").update(value || "uchiha-radius-local-development-key").digest();
}

export function encryptSecret(plainText, configuredKey) {
  if (!plainText) return null;
  const key = encryptionKeyFromConfig(configuredKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload, configuredKey) {
  if (!payload) return null;
  const [version, ivPart, tagPart, encryptedPart] = String(payload).split(".");
  if (version !== "v1" || !ivPart || !tagPart || !encryptedPart) throw new Error("Unsupported encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKeyFromConfig(configuredKey), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function signPayload(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySignedPayload({ secret, timestamp, rawBody, signature, now = Date.now(), maxAgeSeconds = 300 }) {
  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) return false;
  if (Math.abs(Math.floor(now / 1000) - numericTimestamp) > maxAgeSeconds) return false;
  return safeEqual(signPayload(secret, timestamp, rawBody), signature ?? "");
}

function decodeJwtPart(part) {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JWT object");
    return value;
  } catch {
    throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "رمز Google غير صالح");
  }
}

export class GoogleIdTokenVerifier {
  constructor({ clientId, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    this.clientId = clientId;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.keys = null;
    this.keysExpireAt = 0;
    this.keysPending = null;
  }

  async getKeys() {
    if (this.keys && this.keysExpireAt > this.now()) return this.keys;
    if (this.keysPending) return this.keysPending;
    this.keysPending = (async () => {
      try {
        const response = await this.fetchImpl("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error("Key service unavailable");
        const body = await response.json();
        if (!Array.isArray(body.keys) || !body.keys.length) throw new Error("Invalid key set");
        const maxAge = Number.parseInt(/max-age=(\d+)/i.exec(response.headers.get("cache-control") ?? "")?.[1] ?? "300", 10);
        this.keys = body.keys;
        this.keysExpireAt = this.now() + Math.max(60, Math.min(86_400, maxAge)) * 1000;
        return this.keys;
      } catch {
        throw new AppError(503, API_ERROR_CODES.INTEGRATION_NOT_CONFIGURED, "تعذر التحقق من Google مؤقتًا، أعد المحاولة");
      } finally { this.keysPending = null; }
    })();
    return this.keysPending;
  }

  async verify(token) {
    if (!this.clientId || this.clientId.startsWith("replace-")) {
      throw new AppError(503, API_ERROR_CODES.INTEGRATION_NOT_CONFIGURED, "تسجيل Google غير مُعد بعد");
    }
    const parts = String(token ?? "").split(".");
    if (parts.length !== 3) throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "رمز Google غير صالح");
    const header = decodeJwtPart(parts[0]);
    const payload = decodeJwtPart(parts[1]);
    if (header.alg !== "RS256" || !header.kid) throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "خوارزمية رمز Google غير مقبولة");
    const jwk = (await this.getKeys()).find((candidate) => candidate.kid === header.kid);
    if (!jwk) throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "مفتاح Google غير معروف");
    const validSignature = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(parts[2], "base64url")
    );
    const nowSeconds = Math.floor(this.now() / 1000);
    const validIssuer = ["https://accounts.google.com", "accounts.google.com"].includes(payload.iss);
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const validTimes = Number.isSafeInteger(payload.exp) && Number.isSafeInteger(payload.iat)
      && payload.exp > nowSeconds && payload.iat <= nowSeconds + 60 && payload.iat < payload.exp;
    const validIdentity = typeof payload.sub === "string" && payload.sub.length > 0 && payload.sub.length <= 255
      && typeof payload.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
    const validPresenter = !payload.azp || payload.azp === this.clientId;
    if (!validSignature || !validIssuer || !audience.includes(this.clientId) || !validTimes || !validIdentity || !validPresenter || payload.email_verified !== true) {
      throw new AppError(401, API_ERROR_CODES.INVALID_CREDENTIAL, "تعذر إثبات هوية Google");
    }
    return {
      subject: payload.sub,
      email: String(payload.email).toLowerCase(),
      name: payload.name ?? payload.email,
      avatarUrl: payload.picture ?? null
    };
  }
}
