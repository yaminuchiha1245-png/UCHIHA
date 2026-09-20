import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const publicUrl = new URL("../public/", import.meta.url);
const assets = [
  {
    gzip: "platform-v60.html.gz",
    plain: "platform-v60.html",
    sha256: "e0936bdff50e844bc77bdb74feb41943caa24bcbdb87a413d686ff21360084d4"
  },
  {
    gzip: "platform-v60.js.gz",
    plain: "platform-v60.js",
    sha256: "b13ad13605f1a16b7a951de9107f2a099acfc17305634a9c766f0202148a20cb"
  }
];

function normalizedGzip(source, name) {
  if (source[0] === 0x1f && source[1] === 0x8b) return source;
  const text = source.toString("utf8").replace(/\s+/g, "");
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw new Error(`${name} is neither gzip nor Base64 gzip data`);
  }
  const decoded = Buffer.from(text, "base64");
  if (decoded[0] !== 0x1f || decoded[1] !== 0x8b) {
    throw new Error(`${name} Base64 payload is not gzip data`);
  }
  return decoded;
}

for (const asset of assets) {
  const gzipUrl = new URL(asset.gzip, publicUrl);
  const plainUrl = new URL(asset.plain, publicUrl);
  const source = await readFile(gzipUrl);
  const gzip = normalizedGzip(source, asset.gzip);
  const payload = gunzipSync(gzip);
  const actual = createHash("sha256").update(payload).digest("hex");
  if (actual !== asset.sha256) {
    throw new Error(`${asset.gzip} decompressed checksum mismatch: ${actual}`);
  }
  await writeFile(gzipUrl, gzip);
  await writeFile(plainUrl, payload);
  console.log(`Verified and materialized ${asset.gzip} payload ${actual}`);
}
