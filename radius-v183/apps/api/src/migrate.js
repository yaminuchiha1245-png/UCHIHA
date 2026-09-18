import fs from "node:fs";
import path from "node:path";

export async function runMigrations(db, projectRoot) {
  if (db.driver !== "postgres") return { applied: [] };
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const migrationsDirectory = path.join(projectRoot, "infra/postgres/migrations");
  const files = fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql")).sort();
  const applied = [];
  for (const file of files) {
    const exists = await db.get("SELECT name FROM schema_migrations WHERE name = ?", [file]);
    if (exists) continue;
    await db.transaction(async (tx) => {
      await tx.exec(fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
      await tx.run("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    });
    applied.push(file);
  }
  return { applied };
}
