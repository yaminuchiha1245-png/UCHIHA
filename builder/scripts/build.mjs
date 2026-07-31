import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const output = join(root, "dist");
const includes = ["src", "public", "migrations", "package.json", "package-lock.json", "Dockerfile", "railway.json"];
const forbidden = [/(^|\/)\.env($|\.)/, /node_modules/, /(^|\/)uploads\//, /\.(?:log|db|sqlite|pem|key)$/i];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const item of includes) {
  await cp(join(root, item), join(output, item), { recursive: true });
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const files = await walk(output);
const manifest = [];
for (const file of files) {
  const path = relative(output, file).replaceAll("\\", "/");
  if (forbidden.some((pattern) => pattern.test(path))) throw new Error(`Forbidden build artifact: ${path}`);
  const contents = await readFile(file);
  manifest.push({ path, bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") });
}
manifest.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(join(output, "build-manifest.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), files: manifest }, null, 2)}\n`);
console.log(`Build completed with ${manifest.length} runtime files.`);
