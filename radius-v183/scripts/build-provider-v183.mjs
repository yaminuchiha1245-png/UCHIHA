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

function compile({ outputDirectory, apiBase, native }) {
  const reference = fs.readFileSync(referencePath);
  if (sha256(reference) !== lockedReferenceHash) throw new Error("V1-83 reference hash changed; refusing to build a different UI");
  let html = reference.toString("utf8");
  const runtime = fs.readFileSync(runtimePath, "utf8");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`Expected one V1-83 inline script, found ${scripts.length}`);
  let applicationScript = scripts[0][1];
  const marker = "setupExperience();\nbeginProviderPreview();";
  if (!applicationScript.includes(marker)) throw new Error("V1-83 startup marker is missing");
  applicationScript = applicationScript.replace(marker,
    `${runtime}\nsetupUchihaV183Runtime();\n${marker}`);
  const scriptHash = sha256(applicationScript).slice(0, 16);
  const assetName = `provider-v183-${scriptHash}.js`;
  const scriptSource = native ? `assets/${assetName}` : `/provider/assets/${assetName}`;
  const nativeLoader = native ? '<script type="module" src="assets/native-auth.js"></script>\n' : "";
  html = html.replace(scripts[0][0], `${nativeLoader}<script src="${scriptSource}" defer></script>`);
  const runtimeMeta = `<meta name="uchiha-api-base" content="${apiBase}">\n<meta name="uchiha-runtime" content="${native ? "native" : "web"}">`;
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
  results.push(compile({ outputDirectory: path.join(root, "dist", "provider"), apiBase: "", native: false }));
}
if (mode === "mobile" || mode === "all") {
  const apiBase = String(process.env.MOBILE_API_BASE_URL ?? "https://radius.uchiha-builder.com").replace(/\/$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(apiBase)) throw new Error("MOBILE_API_BASE_URL must be an HTTPS origin without a path");
  results.push(compile({ outputDirectory: path.join(root, "apps", "provider-mobile", "www"), apiBase, native: true }));
}
for (const result of results) {
  console.log(`Built V1-83 provider at ${path.relative(root, result.outputDirectory)} with ${result.assetName}`);
}
