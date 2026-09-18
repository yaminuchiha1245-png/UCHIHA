function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  return Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function localDateTimeToUtc(parts, timeZone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualParts = zonedParts(new Date(candidate), timeZone);
    const actual = Date.UTC(actualParts.year, actualParts.month - 1, actualParts.day,
      actualParts.hour, actualParts.minute, actualParts.second);
    const correction = desired - actual;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

function shiftLocalDate(parts, { days = 0, months = 0 } = {}) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0
  };
}

export function quotaWindow(period, timeZone = "UTC", at = new Date()) {
  if (period !== "daily" && period !== "monthly") return null;
  const current = zonedParts(at, timeZone);
  const startParts = period === "monthly"
    ? { year: current.year, month: current.month, day: 1, hour: 0, minute: 0, second: 0 }
    : { year: current.year, month: current.month, day: current.day, hour: 0, minute: 0, second: 0 };
  const endParts = period === "monthly"
    ? shiftLocalDate(startParts, { months: 1 })
    : shiftLocalDate(startParts, { days: 1 });
  return {
    startsAt: localDateTimeToUtc(startParts, timeZone).toISOString(),
    endsAt: localDateTimeToUtc(endParts, timeZone).toISOString()
  };
}

export async function calculateSubscriberUsage(db, {
  tenantId,
  subscriberId,
  quotaBytes,
  quotaPeriod,
  timeZone = "UTC",
  at = new Date()
}) {
  const limitBytes = quotaBytes === null || quotaBytes === undefined ? null : Number(quotaBytes);
  const window = quotaWindow(quotaPeriod, timeZone, at);
  if (!window || !Number.isFinite(limitBytes) || limitBytes <= 0) {
    return {
      period: quotaPeriod ?? "none",
      limitBytes: null,
      usedBytes: 0,
      remainingBytes: null,
      exceeded: false,
      startsAt: null,
      endsAt: null
    };
  }
  const row = await db.get(`SELECT COALESCE(SUM(
      CASE WHEN previous_input IS NULL OR input_bytes < previous_input THEN input_bytes ELSE input_bytes - previous_input END
      + CASE WHEN previous_output IS NULL OR output_bytes < previous_output THEN output_bytes ELSE output_bytes - previous_output END
    ), 0) AS used_bytes
    FROM (
      SELECT occurred_at, input_bytes, output_bytes,
        LAG(input_bytes) OVER (PARTITION BY session_id ORDER BY occurred_at, id) AS previous_input,
        LAG(output_bytes) OVER (PARTITION BY session_id ORDER BY occurred_at, id) AS previous_output
      FROM radius_accounting_events
      WHERE tenant_id = ? AND subscriber_id = ? AND occurred_at < ?
    ) counters
    WHERE occurred_at >= ?`, [tenantId, subscriberId, window.endsAt, window.startsAt]);
  const usedBytes = Math.max(0, Number(row?.used_bytes ?? 0));
  return {
    period: quotaPeriod,
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    exceeded: usedBytes >= limitBytes,
    startsAt: window.startsAt,
    endsAt: window.endsAt
  };
}
