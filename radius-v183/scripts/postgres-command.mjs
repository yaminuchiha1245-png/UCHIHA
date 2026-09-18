import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

// Keep connection passwords out of command arguments and error messages.
export function postgresEnvironment(connectionUrl, base = process.env) {
  let parsed;
  try { parsed = new URL(connectionUrl); } catch { throw new Error("A PostgreSQL connection URL is required"); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname.length < 2 || parsed.hash) {
    throw new Error("PostgreSQL URL must specify a host and database");
  }
  const env = { ...base };
  for (const name of Object.keys(env)) if (name.startsWith("PG")) delete env[name];
  Object.assign(env, {
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""), PGPORT: parsed.port || "5432",
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)), PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password), PGCONNECT_TIMEOUT: "10", PGAPPNAME: "uchiha-maintenance"
  });
  const supported = {
    sslmode: "PGSSLMODE", sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY",
    connect_timeout: "PGCONNECT_TIMEOUT", application_name: "PGAPPNAME", channel_binding: "PGCHANNELBINDING",
    target_session_attrs: "PGTARGETSESSIONATTRS", options: "PGOPTIONS"
  };
  for (const [key, value] of parsed.searchParams) {
    if (!supported[key]) throw new Error("Unsupported PostgreSQL URL parameter; use documented libpq connection options");
    env[supported[key]] = value;
  }
  if (Object.values(env).some((value) => typeof value === "string" && value.includes("\0"))) throw new Error("Invalid connection configuration");
  return env;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [variable, command, ...args] = process.argv.slice(2);
  try {
    if (!["psql", "pg_dump", "pg_restore"].includes(command)) throw new Error("Unsupported PostgreSQL command");
    const env = postgresEnvironment(process.env[variable]);
    const child = spawn(command, ["--no-password", `--dbname=${env.PGDATABASE}`, ...args], { env, stdio: "inherit" });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { process.stderr.write("PostgreSQL command could not start; verify client tools are installed.\n"); process.exitCode = 1; });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
  } catch (error) {
    process.stderr.write(`${error instanceof URIError ? "Invalid connection encoding" : error.message}\n`);
    process.exitCode = 2;
  }
}
