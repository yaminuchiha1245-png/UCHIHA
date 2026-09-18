import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const targetName = process.argv[2] ?? "all";
const apiBase = String(process.env.MOBILE_API_BASE_URL ?? "https://radius.uchiha-builder.com").replace(/\/$/, "");
if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(apiBase)) throw new Error("MOBILE_API_BASE_URL must be an HTTPS origin without a path");
if (process.env.MOBILE_BUILD_MODE === "release") {
  const hostname = new URL(apiBase).hostname;
  if (!process.env.MOBILE_API_BASE_URL || /(^|\.)(example\.(com|net|org)|localhost)$|\.(invalid|test|example)$/i.test(hostname)) {
    throw new Error("Release assets require the real HTTPS API origin; placeholder domains are forbidden");
  }
}

function build(name) {
  const source = path.join(projectRoot, "apps", `${name}-web`);
  const target = path.join(projectRoot, "apps", `${name}-mobile`, "www");
  if (!fs.existsSync(source) || !target.startsWith(path.join(projectRoot, "apps") + path.sep)) throw new Error(`Unsafe or missing mobile source: ${name}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.mkdirSync(path.join(target, "public", "icons"), { recursive: true });

  let html = fs.readFileSync(path.join(source, "index.html"), "utf8");
  html = html.replace(/\s*<link rel="manifest"[^>]*>/, "");
  html = html.replace("<meta name=\"description\"", `<meta name="uchiha-api-base" content="${apiBase}">\n  <meta name="uchiha-runtime" content="native">\n  <meta name="description"`);
  html = html.replace(
    '<script type="module" src="src/app.js"></script>',
    '<script type="module" src="src/native-auth.js"></script>\n  <script type="module" src="src/app.js"></script>'
  );
  fs.writeFileSync(path.join(target, "index.html"), html);
  fs.copyFileSync(path.join(source, "src", "app.js"), path.join(target, "src", "app.js"));
  fs.copyFileSync(path.join(source, "src", "api.js"), path.join(target, "src", "api.js"));
  if (name === "provider") fs.copyFileSync(path.join(source, "src", "operations.js"), path.join(target, "src", "operations.js"));
  fs.copyFileSync(path.join(projectRoot, "apps/mobile-shared/native-auth.js"), path.join(target, "src", "native-auth.js"));
  fs.copyFileSync(path.join(projectRoot, "node_modules/@capacitor/core/dist/index.js"), path.join(target, "src", "capacitor-core.js"));
  for (const icon of ["icon.svg", "icon-192.png", "icon-512.png"]) {
    fs.copyFileSync(path.join(source, "public", "icons", icon), path.join(target, "public", "icons", icon));
  }

  let css = fs.readFileSync(path.join(source, "src", "styles.css"), "utf8");
  if (name === "owner") {
    css = `${fs.readFileSync(path.join(projectRoot, "apps/provider-web/src/styles.css"), "utf8")}\n${css.replace(/^@import[^;]+;\s*/m, "")}`;
  }
  fs.writeFileSync(path.join(target, "src", "styles.css"), css);
  console.log(`Prepared ${name} Android web assets for ${apiBase}`);
}

if (!["all", "provider", "owner"].includes(targetName)) throw new Error("Use all, provider or owner");
for (const name of targetName === "all" ? ["provider", "owner"] : [targetName]) build(name);
