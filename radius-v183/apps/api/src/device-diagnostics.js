// Device registration is not connectivity. This module performs a scoped,
// read-only consistency check and never attempts to reach arbitrary host IPs.
import net from "node:net";

const RECENT_DEVICE_MS = 60_000;
const RECENT_AGENT_MS = 45_000;
export function connectionDiagnostics({ devices, sites, agents, now = Date.now() }) {
  const siteNames = new Map(sites.map(site => [site.id, site.name]));
  const agentSites = new Set(agents.filter(agent =>
    ["healthy", "degraded"].includes(agent.status) &&
    agent.last_seen_at && now - Date.parse(agent.last_seen_at) <= RECENT_AGENT_MS)
    .map(agent => agent.site_id ?? null));
  const counts = new Map();
  const crossSite = new Map();
  for (const device of devices) {
    const key = JSON.stringify([device.site_id ?? null, device.host, Number(device.api_port)]);
    counts.set(key, (counts.get(key) || 0) + 1);
    const addressKey = device.host + ":" + device.api_port;
    if (!crossSite.has(addressKey)) crossSite.set(addressKey, new Set());
    crossSite.get(addressKey).add(device.site_id ?? null);
  }
  const items = devices.map(device => {
    const siteId = device.site_id ?? null;
    const scopeKey = JSON.stringify([siteId, device.host, Number(device.api_port)]);
    const duplicate = (counts.get(scopeKey) || 0) > 1;
    const sameAddressDifferentSites = crossSite.get(device.host + ":" + device.api_port).size > 1;
    const age = device.last_seen_at ? now - Date.parse(device.last_seen_at) : Infinity;
    const verifiedOnline = !duplicate && device.status === "online" &&
      Number.isFinite(age) && age >= 0 && age <= RECENT_DEVICE_MS;
    const agentOnline = agentSites.has(siteId);
    const issues = [];
    if (duplicate) issues.push("DUPLICATE_IN_SITE");
    if (!siteId && (duplicate || sameAddressDifferentSites)) issues.push("ASSIGN_SITE");
    if (Number(device.api_port) !== 8729) issues.push("API_SSL_PORT");
    if (net.isIP(device.host) === 4 && device.host.endsWith(".0")) issues.push("CHECK_ROUTER_IP");
    if (!agentOnline) issues.push("SITE_AGENT_OFFLINE");
    if (!verifiedOnline) issues.push("ROUTER_NOT_VERIFIED");
    // Similar IP addresses across DIFFERENT sites are legitimate. Only an
    // agent bound to that exact site can claim the router is online.
    return {
      id: device.id, name: device.name, siteId,
      siteName: siteId ? siteNames.get(siteId) ?? null : null,
      host: device.host, port: Number(device.api_port),
      connectionMethod: device.connection_method,
      verifiedOnline, agentOnline, sameAddressDifferentSites, issues,
      lastVerifiedAt: verifiedOnline ? device.last_seen_at : null
    };
  });
  return {
    total: items.length, verifiedOnline: items.filter(item => item.verifiedOnline).length,
    requireSiteSeparation: items.some(item => item.issues.includes("DUPLICATE_IN_SITE")),
    items,
    methods: [
      { id: "linux-lan", supported: true, requires: "on-site Linux + trusted RouterOS API-SSL" },
      { id: "docker-lan", supported: true, requires: "on-site Docker + trusted RouterOS API-SSL" },
      { id: "vpn-agent", supported: true, requires: "authorized VPN access + local agent + trusted RouterOS API-SSL" },
      { id: "cloud-direct", supported: false, requires: "not implemented; do not expose router ports to the Internet" }
    ]
  };
}
