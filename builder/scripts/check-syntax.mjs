import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const roots = ["src", "public", "test", "scripts", "mobile/web"];
const ignored = new Set(["node_modules", "dist", "build"]);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if ([".js", ".mjs"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = (await Promise.all(roots.map((path) => walk(join(root, path))))).flat().sort();
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
