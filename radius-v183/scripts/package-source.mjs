import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const outputDirectory = path.resolve(process.argv[2] ?? path.join(root, "dist"));
const output = path.join(outputDirectory, `UCHIHA-RADIUS-${version}-SOURCE.zip`);
const excludedDirectories = new Set(["node_modules", ".git", ".gradle", ".sites-runtime", "dist", "build", "data", "www", ".idea"]);
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || full === outputDirectory) continue;
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) collect(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, full);
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    if (/\.(?:sqlite(?:-wal|-shm)?|db|jks|keystore|p12|pfx|pem|key|log|dump|zip|aab|apk)$/i.test(entry.name)) continue;
    if (["local.properties", "google-services.json"].includes(entry.name)) continue;
    if (/android\/app\/src\/main\/assets\/public\//.test(relative)) continue;
    if (/[\r\n]/.test(relative)) throw new Error("Unsupported source filename");
    files.push(relative);
  }
}
collect(root);
files.sort();
for (const required of ["package.json", "package-lock.json", ".env.example", "docs/release-status.md", "reference/UCHIHA-RADIUS-UI-V1-83.html"]) {
  if (!files.includes(required)) throw new Error(`Required release source is missing: ${required}`);
}
const archive = spawnSync("zip", ["-q", "-", "-@"], { cwd: root, input: files.join("\n") + "\n", maxBuffer: 64 * 1024 * 1024 });
if (archive.status !== 0) throw new Error("Source archive failed; verify zip is installed");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(output, archive.stdout);
const verify = spawnSync("unzip", ["-tqq", output], { encoding: "utf8" });
if (verify.status !== 0) throw new Error("Source archive verification failed");
const checksum = createHash("sha256").update(archive.stdout).digest("hex");
fs.writeFileSync(`${output}.sha256`, `${checksum}  ${path.basename(output)}\n`);
console.log(JSON.stringify({ output, checksumFile: `${output}.sha256`, sourceFiles: files.length, bytes: archive.stdout.length }));
