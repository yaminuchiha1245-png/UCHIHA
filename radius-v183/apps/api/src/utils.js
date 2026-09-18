import { randomUUID } from "node:crypto";

export function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function addHours(iso, hours) {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

export function addDays(iso, days) {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function pageFromQuery(query = {}) {
  const limit = clamp(Number.parseInt(query.limit ?? "20", 10) || 20, 1, 100);
  const offset = Math.max(0, Number.parseInt(query.offset ?? "0", 10) || 0);
  return { limit, offset };
}

export function publicId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9]*_[a-f0-9]{32}$/i.test(value);
}
