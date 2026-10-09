// Device registration is not connectivity. This module performs a scoped,
// read-only consistency check and never attempts to reach arbitrary host IPs.
import net from "node:net";

const RECENT_DEVICE_MS = 60_000;
const RECENT_AGENT_MS = 45_000;
// Provider-facing guidance is explanatory only: it never enables network access.
// A verified management channel is NOT proof that subscriber AAA/accounting works.
function onboardingGuidance(issues, verifiedOnline) {
  const guidance = [
    ["CHECK_ROUTER_IP", "review-address",
      "راجع عنوان MikroTik المسجل مع صاحب الشبكة. لم نتأكد أنه عنوان الجهاز الحقيقي.",
      "Review the saved MikroTik address with the network owner; it is not verified."],
    ["DUPLICATE_IN_SITE", "review-duplicates",
      "توجد أجهزة مكررة في نفس الموقع. راجعها قبل متابعة الربط.",
      "Duplicate routers exist at this site. Review them before continuing."],
    ["ASSIGN_SITE", "assign-site",
      "اربط الجهاز بموقع الشبكة أولًا حتى نتمكن من التحقق من الاتصال الصحيح.",
      "Assign the router to its network site before checking connectivity."],
    ["SITE_AGENT_OFFLINE", "connect-site",
      "برنامج الاتصال داخل شبكة المزود غير متصل. يحتاج تشغيله على جهاز مصرح له داخل الشبكة.",
      "The provider's on-site connector is offline. Start the authorized local connector."],
    ["API_SSL_PORT", "secure-api",
      "الربط المباشر يحتاج منفذ API-SSL الآمن 8729 وشهادة موثوقة.",
      "Direct access requires trusted API-SSL on port 8729."],
    ["ROUTER_NOT_VERIFIED", "verify-router",
      "الجهاز مسجل، لكن الاتصال الحقيقي لم يُثبت بعد. أعد فحص اتصال MikroTik.",
      "Router saved, but its real connection is unverified. Run a MikroTik connection check."]
  ];
  // An issue requiring owner attention takes precedence over a stale online claim.
  for (const [issue, code, ar, en] of guidance) {
    if (issues.includes(issue)) return { code, stage: "action-required", message: { ar, en } };
  }
  if (verifiedOnline) return {
    code: "management-verified", stage: "management-only",
    message: {
      ar: "تم التحقق من اتصال إدارة MikroTik. ما زال اختبار دخول المشتركين واحتساب الاستهلاك مطلوبًا.",
      en: "MikroTik management verified. Subscriber authentication and accounting still require testing."
    }
  };
  return {
    code: "verification-required", stage: "action-required",
    message: { ar: "لم يتم التحقق من اتصال الجهاز.", en: "Router connection has not been verified." }
  };
}

export function connectionDiagnostics({ devices, sites, agents, config = {}, now = Date.now() }) {
  const siteNames = new Map(sites.map(site => [site.id, site.name]));
  const agentSites = new Set(agents.filter(agent =>
    ["healthy", "degraded"].includes(agent.status) &&
    agent.last_seen_at && now - Date.parse(agent.last_seen_at) <= RECENT_AGENT_MS)
    .map(agent => agent.site_id ?? null));
  const counts = new Map();
  const verifiedCounts = new Map();
  const crossSite = new Map();
  for (const device of devices) {
    const key = JSON.stringify([device.site_id ?? null, String(device.host).toLowerCase(), Number(device.api_port)]);
    counts.set(key, (counts.get(key) || 0) + 1);
    const age = device.last_seen_at ? now - Date.parse(device.last_seen_at) : Infinity;
    if (device.status === "online" && Number.isFinite(age) && age >= 0 && age <= RECENT_DEVICE_MS)
      verifiedCounts.set(key, (verifiedCounts.get(key) || 0) + 1);
    const addressKey = String(device.host).toLowerCase() + ":" + device.api_port;
    if (!crossSite.has(addressKey)) crossSite.set(addressKey, new Set());
    crossSite.get(addressKey).add(device.site_id ?? null);
  }
  const items = devices.map(device => {
    const siteId = device.site_id ?? null;
    const scopeKey = JSON.stringify([siteId, String(device.host).toLowerCase(), Number(device.api_port)]);
    const duplicate = (counts.get(scopeKey) || 0) > 1;
    const sameAddressDifferentSites = crossSite.get(String(device.host).toLowerCase() + ":" + device.api_port).size > 1;
    const age = device.last_seen_at ? now - Date.parse(device.last_seen_at) : Infinity;
    // A duplicate registration is allowed to remain for audit; a single
    // signed probe for the actual router ID can still be verified. Two fresh
    // online claims at the same site/endpoint remain ambiguous and fail closed.
    const agentOnline = siteId !== null && agentSites.has(siteId);
    const requiresAgent = !["api", "vpn"].includes(device.connection_method);
    const verifiedOnline = (!duplicate || verifiedCounts.get(scopeKey) === 1) &&
      device.status === "online" && Number.isFinite(age) && age >= 0 && age <= RECENT_DEVICE_MS &&
      (!requiresAgent || agentOnline);
    const issues = [];
    if (duplicate) issues.push("DUPLICATE_IN_SITE");
    if (!siteId && (duplicate || sameAddressDifferentSites || requiresAgent)) issues.push("ASSIGN_SITE");
    // Legacy 8728 inside an authenticated site tunnel is not a public API-SSL endpoint.
    if (device.connection_method === "api" && Number(device.api_port) !== 8729) issues.push("API_SSL_PORT");
    if (net.isIP(device.host) === 4 && device.host.endsWith(".0")) issues.push("CHECK_ROUTER_IP");
    if (requiresAgent && !agentOnline)
      issues.push("SITE_AGENT_OFFLINE");
    if (!verifiedOnline) issues.push("ROUTER_NOT_VERIFIED");
    // Similar IP addresses across DIFFERENT sites are legitimate. Only an
    // agent bound to that exact site can claim the router is online.
    return {
      id: device.id, name: device.name, siteId,
      siteName: siteId ? siteNames.get(siteId) ?? null : null,
      host: device.host, port: Number(device.api_port),
      connectionMethod: device.connection_method,
      verifiedOnline, agentOnline, sameAddressDifferentSites, issues,
      onboarding: onboardingGuidance(issues, verifiedOnline),
      lastVerifiedAt: verifiedOnline ? device.last_seen_at : null
    };
  });
  return {
    total: items.length,
    uniqueEndpoints: counts.size,
    verifiedOnline: items.filter(item => item.verifiedOnline).length,
    requireSiteSeparation: items.some(item => item.issues.includes("DUPLICATE_IN_SITE")),
    items,
    methods: [
      { id: "linux-lan", supported: true, requires: "on-site Linux + trusted RouterOS API-SSL" },
      { id: "docker-lan", supported: true, requires: "on-site Docker + trusted RouterOS API-SSL" },
      { id: "vpn-agent", supported: true, requires: "authorized VPN access + local agent + trusted RouterOS API-SSL" },
      { id: "direct-public-api-ssl", supported: !!config.directRouterAllowPublic,
        requires: "reachable approved public router + valid API-SSL certificate" },
      { id: "direct-private-vpn", supported: !!config.directRouterAllowedCidrs?.length,
        requires: "approved private VPN route and trusted API-SSL" },
      { id: "cloud-direct", supported: false, requires: "arbitrary unapproved router IPs are blocked" }
    ]
  };
}
