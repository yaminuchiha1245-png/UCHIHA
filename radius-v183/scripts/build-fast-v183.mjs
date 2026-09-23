// Fast packaging of the LOCKED V1-83 UI. Does not modify the source layout.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

const root = process.cwd();
const source = path.join(root, "dist", "provider");
const output = path.join(root, "dist", "fast-v183");
const assetDir = path.join(output, "assets");
const prefix = process.env.FAST_V183_PREFIX || "/v183/";
if (!/^\/[a-z0-9-/]+\/$/.test(prefix)) throw Error("Invalid FAST_V183_PREFIX");
const reference = fs.readFileSync(path.join(root, "reference", "UCHIHA-RADIUS-UI-V1-83.html"));
const hash = (value, n = 16) => crypto.createHash("sha256").update(value).digest("hex").slice(0, n);
const expected = "bdfea1a81d3a82e96330d1a287bc1120046c53af59eca68bb1a3afd452756237";
if (hash(reference, 64) !== expected) throw Error("Wrong RADIUS UI reference; refusing to build.");
const sourceHtml = fs.readFileSync(path.join(source, "index.html"), "utf8");
if (!sourceHtml.includes("V1-83") || !sourceHtml.includes("provider-v183-")) throw Error("Not the V1-83 compiled page.");
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(assetDir, { recursive: true });
function saveAsset(name, bytes, gzip = false) {
  const full = path.join(assetDir, name);
  fs.writeFileSync(full, bytes);
  if (gzip) fs.writeFileSync(full + ".gz", zlib.gzipSync(bytes, { level: 9 }));
}
const assetUrls = new Map();
let html = sourceHtml.replace(
  /data:(image\/(?:webp|svg\+xml)|font\/woff2);base64,([A-Za-z0-9+/=]+)/g,
  (uri, mime, encoded) => {
    if (assetUrls.has(uri)) return assetUrls.get(uri);
    const bytes = Buffer.from(encoded, "base64");
    const ext = mime === "font/woff2" ? ".woff2" : mime === "image/webp" ? ".webp" : ".svg";
    const name = "asset-" + hash(bytes) + ext;
    saveAsset(name, bytes);
    const url = prefix + "assets/" + name;
    assetUrls.set(uri, url);
    return url;
  }
);
let styles = 0;
html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
  const data = Buffer.from(css);
  const name = "style-" + styles++ + "-" + hash(data) + ".css";
  saveAsset(name, data, true);
  return '<link rel="stylesheet" href="' + prefix + 'assets/' + name + '">';
});
if (styles < 4) throw Error("Expected all four V1-83 style blocks");
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"\s+defer><\/script>/g)];
if (scripts.length !== 1 || !scripts[0][1].startsWith("/provider/assets/provider-v183-")) throw Error("Wrong V1-83 runtime");
const js = fs.readFileSync(path.join(source, "assets", path.basename(scripts[0][1])));
const jsName = "runtime-" + hash(js) + ".js";
saveAsset(jsName, js, true);
html = html.replace(scripts[0][1], prefix + "assets/" + jsName);
html = html.replace(/<link\b[^>]*rel="manifest"[^>]*>/gi, "");
// Telegram's official SDK is required for cryptographically signed Mini App login.
// Deferred download in <head> runs before the original V1-83 deferred runtime.
html = html.replace("</head>",
  '<script defer src="https://telegram.org/js/telegram-web-app.js"></script>\n</head>');
const bytes = Buffer.from(html);
fs.writeFileSync(path.join(output, "index.html"), bytes);
fs.writeFileSync(path.join(output, "index.html.gz"), zlib.gzipSync(bytes, { level: 9 }));
const sizes = fs.readdirSync(assetDir).filter(name => !name.endsWith(".gz")).map(name => ({
  name, bytes: fs.statSync(path.join(assetDir, name)).size
}));
if (html.includes("data:image/webp;base64") || html.includes("/provider/assets/")) throw Error("Unsplit assets remain");
console.log(JSON.stringify({
  referenceSha256: expected, prefix, htmlBytes: bytes.length,
  htmlGzipBytes: fs.statSync(path.join(output, "index.html.gz")).size,
  styles, runtimeBytes: js.length, assets: sizes.length,
  largestAssets: sizes.sort((a,b)=>b.bytes-a.bytes).slice(0,6)
}, null, 2));
