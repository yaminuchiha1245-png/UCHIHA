import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const checkedExtensions = new Set([".mjs", ".js", ".json", ".html", ".css", ".sql", ".md", ".yml", ".yaml"]);
const ignoredDirectories = new Set(["node_modules", "dist", ".git", "coverage", "build"]);
const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (checkedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function report(file, line, message) {
  errors.push(`${relative(root, file)}:${line}: ${message}`);
}

const files = await walk(root);
for (const file of files) {
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/[ \t]+$/.test(line)) report(file, index + 1, "trailing whitespace");
    if (/^(<{7}|={7}|>{7})/.test(line)) report(file, index + 1, "unresolved merge marker");
  }
  if (extname(file) === ".json") {
    try { JSON.parse(text); } catch (error) { report(file, 1, `invalid JSON: ${error.message}`); }
  }
  if (extname(file) === ".html") {
    const staticHtml = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const ids = [...staticHtml.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) report(file, 1, `duplicate HTML id: ${id}`);
      seen.add(id);
    }
  }
  if ([".mjs", ".js"].includes(extname(file))) {
    for (const match of text.matchAll(/(?:from\s+|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const requested = resolve(file, "..", match[1]);
      const candidates = [requested, `${requested}.mjs`, `${requested}.js`, join(requested, "index.mjs"), join(requested, "index.js")];
      let found = false;
      for (const candidate of candidates) {
        try { await readFile(candidate); found = true; break; } catch { /* try next */ }
      }
      if (!found) report(file, text.slice(0, match.index).split("\n").length, `unresolved local import: ${match[1]}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Lint passed for ${files.length} source files.`);
}
