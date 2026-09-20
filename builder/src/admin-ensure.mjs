import { randomUUID } from "node:crypto";
import { createRuntime } from "./runtime.mjs";
import { hashPassword, normalizeEmail } from "./security.mjs";

const email = normalizeEmail(process.env.PLATFORM_ADMIN_EMAIL || "");
const password = String(process.env.PLATFORM_ADMIN_PASSWORD || "");

if (!email || !password) {
  console.error(JSON.stringify({
    ok: false,
    error: "PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD are required"
  }));
  process.exit(1);
}
if (password.length < 14) {
  console.error(JSON.stringify({ ok: false, error: "Platform admin password must contain at least 14 characters" }));
  process.exit(1);
}

const { db } = await createRuntime({ seed: false });
try {
  const passwordHash = await hashPassword(password);
  const result = await db.transaction(async (client) => {
    const existing = (await client.query(
      "SELECT id FROM platform_users WHERE email=$1 FOR UPDATE",
      [email]
    )).rows[0];
    if (existing) {
      await client.query(
        `UPDATE platform_users
         SET password_hash=$2, is_platform_admin=TRUE, status='active', updated_at=NOW()
         WHERE id=$1`,
        [existing.id, passwordHash]
      );
      await client.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL", [existing.id]);
      return { id: existing.id, created: false, sessionsRevoked: true };
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO platform_users (
         id, email, display_name, password_hash, is_platform_admin, status
       ) VALUES ($1,$2,'UCHIHA Platform Admin',$3,TRUE,'active')`,
      [id, email, passwordHash]
    );
    return { id, created: true, sessionsRevoked: false };
  });
  console.log(JSON.stringify({ ok: true, email, ...result }, null, 2));
} finally {
  await db.close();
}
