import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mode = process.argv[2] ?? "all";
if (!["server", "mobile", "all"].includes(mode)) throw new Error("Use server, mobile or all");

const referencePath = path.join(root, "reference", "UCHIHA-RADIUS-UI-V1-83.html");
const runtimePath = path.join(root, "apps", "provider-v183-runtime", "runtime.js");
const lockedReferenceHash = "bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237";
const forbiddenRuntimeHosts = ["chatgpt.site", "railway.app", "radius.example.com"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compile({ outputDirectory, apiBase, native, buildChannel = "preview" }) {
  const reference = fs.readFileSync(referencePath);
  if (sha256(reference) !== lockedReferenceHash) throw new Error("V1-83 reference hash changed; refusing to build a different UI");
  let html = reference.toString("utf8");
  // Branding only: hide the immutable reference's preview title in real builds.
  if (buildChannel === "release") html = html.replace("<title>UCHIHA RADIUS · Provider Preview V1-83</title>", "<title>UCHIHA RADIUS · V1-83</title>");
  // Keep the approved V1-83 markup and layout, but the deployed Mini App
  // must never advertise Google sign-in or sample/free browsing when these
  // modes are disabled. These are copy-only changes to the release build.
  if (!native && buildChannel === "release") {
    const copy = [
      ["متابعة باستخدام Google", "فتح بوت UCHIHA RADIUS"],
      ["Continue with Google", "Open the UCHIHA RADIUS bot"],
      ["محاكاة للدخول فقط — لا نفتح حساب Google ولا نطلب بياناته.", "سجّل الدخول عبر بوت تيليغرام الموثّق."],
      ["Sign-in simulation only — no Google account access or credentials requested.", "Sign in through the verified Telegram bot."],
      ["تصفّح بحرية، واشترك عندما تصبح جاهزًا.", "البيانات متاحة فقط لأصحاب الشبكات المصرّح لهم."],
      ["Explore freely. Subscribe when you are ready.", "Only authorized providers can access live data."],
      ["معاينة تطبيق المزود · إدارة المنصة لها تطبيق مستقل", "واجهة المزود V1-83 · مرتبطة بقاعدة بيانات حقيقية"],
      ["Provider app preview · Platform administration has a separate app", "Provider V1-83 · Connected to actual server records"],
    ];
    for (const [before, after] of copy) {
      if (!html.includes(before)) throw new Error("Locked V1-83 release text not found: " + before);
      html = html.replaceAll(before, after);
    }
  }
  const runtime = fs.readFileSync(runtimePath, "utf8");
  const liveViews = fs.readFileSync(path.join(root, "apps", "provider-v183-runtime", "live-views.js"), "utf8");
  const liveIntegrations = fs.readFileSync(path.join(root, "apps", "provider-v183-runtime", "live-integrations.js"), "utf8");
  const liveRouterRepair = fs.readFileSync(path.join(root, "apps", "provider-v183-runtime", "live-router-repair.js"), "utf8");
  const liveDirectConnect = fs.readFileSync(path.join(root, "apps", "provider-v183-runtime", "live-direct-connect.js"), "utf8");
  const liveDashboard = fs.readFileSync(path.join(root, "apps", "provider-v183-runtime", "live-dashboard.js"), "utf8");
  if (!liveDashboard.includes("function installV183LiveDashboard(state)")) {
    throw new Error("Live-only metrics must be included in a V1-83 release.");
  }
  if (!runtime.includes("installV183LiveWorkspaces(state,request)") ||
      !liveViews.includes("function installV183LiveWorkspaces(state, apiRequest)")) {
    throw new Error("Production live-only workspaces and API wiring are required.");
  }
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`Expected one V1-83 inline script, found ${scripts.length}`);
  let applicationScript = scripts[0][1];
  // The frozen preview divides by zero on a newly created network. Retain
  // identical markup and layout while showing an honest unavailable value.
  const oldSessionMetrics = "const auth=(list.reduce((s,p)=>s+p.auth*p.sessions,0)/sessions).toFixed(1),latency=Math.round(list.reduce((s,p)=>s+p.latency*p.sessions,0)/sessions)";
  const realSessionMetrics = "const auth=sessions?(list.reduce((s,p)=>s+p.auth*p.sessions,0)/sessions).toFixed(1):'—',latency=sessions?Math.round(list.reduce((s,p)=>s+p.latency*p.sessions,0)/sessions):0";
  if (!applicationScript.includes(oldSessionMetrics)) throw new Error("Locked dashboard zero-data guard was not found");
  applicationScript = applicationScript.replace(oldSessionMetrics, realSessionMetrics);
  const marker = "setupExperience();\nbeginProviderPreview();";
  if (!applicationScript.includes(marker)) throw new Error("V1-83 startup marker is missing");
  applicationScript = applicationScript.replace(marker,
    `${liveIntegrations}\n${liveRouterRepair}\n${liveDirectConnect}\n${liveViews}\n${liveDashboard}\n${runtime}\nsetupUchihaV183Runtime();\n${marker}`);
  const scriptHash = sha256(applicationScript).slice(0, 16);
  const assetName = `provider-v183-${scriptHash}.js`;
  const scriptSource = native ? `assets/${assetName}` : `/provider/assets/${assetName}`;
  const nativeLoader = native ? '<script type="module" src="assets/native-auth.js"></script>\n' : "";
  html = html.replace(scripts[0][0], `${nativeLoader}<script src="${scriptSource}" defer></script>`);
  const runtimeMeta = `<meta name="uchiha-api-base" content="${apiBase}">\n<meta name="uchiha-runtime" content="${native ? "native" : "web"}">\n<meta name="uchiha-build-channel" content="${buildChannel}">`;
  html = html.replace("<meta name=\"viewport\"", `${runtimeMeta}\n<meta name="viewport"`);
  for (const host of forbiddenRuntimeHosts) {
    if (html.toLowerCase().includes(host) || applicationScript.toLowerCase().includes(host)) {
      throw new Error(`Forbidden runtime host found: ${host}`);
    }
  }
  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDirectory, "assets"), { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "index.html"), html);
  fs.writeFileSync(path.join(outputDirectory, "assets", assetName), applicationScript);
  if (native) {
    fs.copyFileSync(path.join(root, "apps", "mobile-shared", "native-auth.js"), path.join(outputDirectory, "assets", "native-auth.js"));
    fs.copyFileSync(path.join(root, "node_modules", "@capacitor", "core", "dist", "index.js"), path.join(outputDirectory, "assets", "capacitor-core.js"));
  }
  return { outputDirectory, assetName, referenceHash: lockedReferenceHash, scriptHash: sha256(applicationScript) };
}

const results = [];
if (mode === "server" || mode === "all") {
  results.push(compile({ outputDirectory: path.join(root, "dist", "provider"), apiBase: "", native: false, buildChannel: "release" }));
}
if (mode === "mobile" || mode === "all") {
  const apiBase = String(process.env.MOBILE_API_BASE_URL ?? "https://radius.uchiha-builder.com").replace(/\/$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(apiBase)) throw new Error("MOBILE_API_BASE_URL must be an HTTPS origin without a path");
  const buildChannel = process.env.MOBILE_BUILD_MODE === "release" ? "release" : "preview";
  if (buildChannel === "release" && !process.env.MOBILE_API_BASE_URL) throw new Error("Release assets require an explicit MOBILE_API_BASE_URL");
  results.push(compile({ outputDirectory: path.join(root, "apps", "provider-mobile", "www"), apiBase, native: true, buildChannel }));
}
for (const result of results) {
  console.log(`Built V1-83 provider at ${path.relative(root, result.outputDirectory)} with ${result.assetName}`);
}
