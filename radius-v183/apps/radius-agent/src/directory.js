import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

function encryptLocal(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptLocal(value, key) {
  const [version, iv, tag, encrypted] = String(value ?? "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid cached credential");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function secretEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function first(payload, key) {
  const value = payload[key] ?? payload[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeAuthentication(payload) {
  const username = String(first(payload, "User-Name") ?? "").trim();
  const password = String(first(payload, "User-Password") ?? "");
  if (!username || !password) throw new Error("User-Name and User-Password are required");
  return {
    username,
    password,
    requestId: String(first(payload, "Packet-Id") ?? first(payload, "Request-Id") ?? randomBytes(12).toString("hex")).slice(0, 128),
    nasIp: String(first(payload, "NAS-IP-Address") ?? "").trim() || null,
    clientIp: String(first(payload, "Calling-Station-Id") ?? first(payload, "Framed-IP-Address") ?? "").trim() || null
  };
}

export function normalizeAuthorization(payload) {
  const username = String(first(payload, "User-Name") ?? "").trim();
  if (!username) throw new Error("User-Name is required");
  let authMethod = "pap";
  if (first(payload, "MS-CHAP2-Response")) authMethod = "mschapv2";
  else if (first(payload, "MS-CHAP-Response")) authMethod = "mschap";
  else if (first(payload, "CHAP-Password")) authMethod = "chap";
  return {
    username,
    authMethod,
    requestId: String(first(payload, "Packet-Id") ?? first(payload, "Request-Id") ?? randomBytes(12).toString("hex")).slice(0, 128),
    nasIp: String(first(payload, "NAS-IP-Address") ?? "").trim() || null,
    clientIp: String(first(payload, "Calling-Station-Id") ?? first(payload, "Framed-IP-Address") ?? "").trim() || null
  };
}

export function normalizePostAuth(payload, now = new Date()) {
  const authorization = normalizeAuthorization(payload);
  const packetType = String(first(payload, "Packet-Type") ?? first(payload, "Response-Packet-Type") ?? "").toLowerCase();
  const result = packetType.includes("accept") ? "accept" : packetType.includes("challenge") ? "challenge" : packetType.includes("reject") ? "reject" : "error";
  const reason = String(first(payload, "Module-Failure-Message") ?? (result === "accept" ? "matched" : result === "reject" ? "authentication_failed" : "unknown_result"))
    .replaceAll(/[\r\n]/g, " ").slice(0, 120);
  return { ...authorization, result, reason, occurredAt: now.toISOString() };
}

function radiusValue(type, value) {
  return { type, value: [String(value)] };
}

export function radiusReply(attributes = {}) {
  const reply = {};
  const down = Number(attributes.rateLimitDownMbps ?? 0);
  const up = Number(attributes.rateLimitUpMbps ?? 0);
  if (down > 0 && up > 0) reply["reply:Mikrotik-Rate-Limit"] = radiusValue("string", `${up}M/${down}M`);
  if (Number(attributes.idleTimeoutSeconds) > 0) reply["reply:Idle-Timeout"] = radiusValue("integer", attributes.idleTimeoutSeconds);
  if (Number(attributes.sessionTimeoutSeconds) > 0) reply["reply:Session-Timeout"] = radiusValue("integer", attributes.sessionTimeoutSeconds);
  if (Number(attributes.interimIntervalSeconds) > 0) reply["reply:Acct-Interim-Interval"] = radiusValue("integer", attributes.interimIntervalSeconds);
  if (Number(attributes.simultaneousUse) > 0) reply["control:Simultaneous-Use"] = radiusValue("integer", attributes.simultaneousUse);
  if (attributes.framedPool) reply["reply:Framed-Pool"] = radiusValue("string", attributes.framedPool);
  return reply;
}

export function radiusAuthorizeReply(password, attributes = {}) {
  return { "control:Cleartext-Password": radiusValue("string", password), ...radiusReply(attributes) };
}

export class RadiusDirectory {
  constructor(db, encryptionKeyHex) {
    this.db = db;
    this.key = Buffer.from(encryptionKeyHex, "hex");
    if (this.key.length !== 32) throw new Error("RADIUS_AGENT_CACHE_KEY must be exactly 64 hexadecimal characters");
  }

  replace(principals, generatedAt) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM radius_directory").run();
      const insert = this.db.prepare(`INSERT INTO radius_directory
        (username, principal_type, principal_id, secret_ciphertext, credential_version, status, expires_at, attributes_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const principal of principals) {
        insert.run(principal.username, principal.principalType, principal.principalId,
          encryptLocal(principal.password, this.key), Number(principal.credentialVersion ?? 1), principal.status,
          principal.expiresAt ?? null, JSON.stringify(principal.attributes ?? {}), generatedAt);
      }
      this.db.prepare(`INSERT INTO agent_state (key, value, updated_at) VALUES ('directory_synced_at', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(generatedAt, generatedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  authenticate(input, now = new Date()) {
    const authorization = this.authorize({ ...input, authMethod: "pap" }, now);
    if (authorization.result !== "ok") return { ...authorization, result: authorization.result === "error" ? "error" : "reject" };
    if (!secretEqual(authorization.password, input.password)) {
      return { ...authorization, password: undefined, result: "reject", reason: "invalid_credentials", attributes: {} };
    }
    return { ...authorization, password: undefined, result: "accept", reason: "matched" };
  }

  authorize(input, now = new Date()) {
    const row = this.db.prepare("SELECT * FROM radius_directory WHERE username = ?").get(input.username);
    const occurredAt = now.toISOString();
    const base = {
      requestId: input.requestId,
      username: input.username,
      nasIp: input.nasIp,
      clientIp: input.clientIp,
      principalType: row?.principal_type ?? null,
      principalId: row?.principal_id ?? null,
      occurredAt
    };
    if (!row) return { ...base, result: "reject", reason: "invalid_credentials", attributes: {} };
    if (row.status === "quota_blocked") return { ...base, result: "reject", reason: "quota_exceeded", attributes: {} };
    const allowedStatuses = row.principal_type === "voucher" ? ["available", "assigned", "active"] : ["active"];
    if (!allowedStatuses.includes(row.status)) return { ...base, result: "reject", reason: "account_inactive", attributes: {} };
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
      return { ...base, result: "reject", reason: "account_expired", attributes: {} };
    }
    const attributes = JSON.parse(row.attributes_json || "{}");
    const allowedMethods = Array.isArray(attributes.authMethods) && attributes.authMethods.length
      ? attributes.authMethods
      : ["pap", "chap", "mschap", "mschapv2"];
    if (!allowedMethods.includes(input.authMethod ?? "pap")) return { ...base, result: "reject", reason: "auth_method_not_allowed", attributes: {} };
    if (Array.isArray(attributes.allowedNasIps) &&
        (!input.nasIp || !attributes.allowedNasIps.includes(input.nasIp))) {
      return { ...base, result: "reject", reason: "plan_scope_mismatch", attributes: {} };
    }
    let password;
    try {
      password = decryptLocal(row.secret_ciphertext, this.key);
    } catch {
      return { ...base, result: "error", reason: "credential_cache_error", attributes: {} };
    }
    return { ...base, result: "ok", reason: "directory_match", password, attributes };
  }

  count() {
    return Number(this.db.prepare("SELECT COUNT(*) AS total FROM radius_directory").get().total);
  }

  syncedAt() {
    return this.db.prepare("SELECT value FROM agent_state WHERE key = 'directory_synced_at'").get()?.value ?? null;
  }
}
