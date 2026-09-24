import fs from "node:fs";
import { loadAgentConfig, loadRouters } from "./apps/radius-agent/src/index.js";
import { RouterOsCommandExecutor } from "./apps/radius-agent/src/routeros.js";

const envPath = process.env.UCHIHA_AGENT_ENV ?? "/etc/uchiha-radius/radius-agent.env";
const source = fs.readFileSync(envPath, "utf8");
for (const line of source.split(/\r?\n/)) {
  const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match) continue;
  let value = match[2].trim();
  if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
  process.env[match[1]] = value;
}
if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ required");
const config = loadAgentConfig();
const routers = loadRouters(config.routersFile);
if (config.host !== "127.0.0.1") throw new Error("Agent must bind only to 127.0.0.1");
for (const r of routers) {
  if (!/^dev_[A-Za-z0-9_-]{8,55}$/.test(r.id)) throw new Error("Use the exact device ID from your provider account");
  if ([r.username, r.password, r.serverName].some(v => /^(replace[-_])/i.test(v ?? "")))
    throw new Error("Replace router credentials and certificate placeholders locally");
  if (r.port !== 8729) throw new Error("Only encrypted API-SSL 8729 is supported");
}
console.log("CONFIG_VALID", "routers=" + routers.length, "local HTTP only");
if (process.argv.includes("--probe")) {
  const results = await new RouterOsCommandExecutor({ routers }).probeRouters({diagnostics:true});
  for (const r of results) console.log(r.status.toUpperCase(), r.deviceId, r.host, r.port, r.errorCode ?? "VERIFIED");
  if (results.some(r => r.status !== "online")) process.exitCode = 1;
}
