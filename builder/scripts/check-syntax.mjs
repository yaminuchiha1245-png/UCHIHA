import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(new URL("..", import.meta.url).pathname);
const roots = ["src", "public", "test", "scripts", "mobile/web"];
const ignored = new Set(["node_modules", "dist", "build"]);

function isJavaScript(path) {
  return [".js", ".mjs"].includes(extname(path));
}

function isCompressedJavaScript(path) {
  return path.endsWith(".js.gz") || path.endsWith(".mjs.gz");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (isJavaScript(path) || isCompressedJavaScript(path)) files.push(path);
  }
  return files;
}

const files = (await Promise.all(roots.map((path) => walk(join(root, path))))).flat().sort();
for (const file of files) {
  let result;
  try {
    if (isCompressedJavaScript(file)) {
      const source = gunzipSync(await readFile(file));
      result = spawnSync(process.execPath, ["--check", "-"], {
        input: source,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024
      });
    } else {
      result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    }
  } catch (error) {
    process.stderr.write(`Failed to read/decompress ${relative(root, file)}: ${error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.stderr.write(`Syntax check failed: ${relative(root, file)}\n`);
    process.stderr.write(result.stderr || result.stdout || "Unknown syntax-check failure\n");
    process.exit(result.status || 1);
  }
}
console.log(`Syntax check passed for ${files.length} JavaScript files (including compressed runtimes).`);
