import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.resolve(process.argv[2] ?? path.join(root, "dist", "UCHIHA-RADIUS-1.0.0-rc.1-PREVIEW.html"));
fs.mkdirSync(path.dirname(output), { recursive: true });

let html = fs.readFileSync(path.join(root, "apps/provider-web/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "apps/provider-web/src/styles.css"), "utf8").replaceAll("</style", "<\\/style");
const mock = fs.readFileSync(path.join(root, "scripts/preview-mock.js"), "utf8");
const mockOperations = fs.readFileSync(path.join(root, "scripts/preview-operations.js"), "utf8");
const api = fs.readFileSync(path.join(root, "apps/provider-web/src/api.js"), "utf8").replace(/^export /gm, "");
const operations = fs.readFileSync(path.join(root, "apps/provider-web/src/operations.js"), "utf8").replace(/^export /gm, "");
const app = fs.readFileSync(path.join(root, "apps/provider-web/src/app.js"), "utf8").replace(/^import \{[^\n]+\} from "\.\/(?:api|operations)\.js";\s*/gm, "");
const script = `${mock}\n${mockOperations}\n${api}\n${operations}\n${app}`.replaceAll("</script", "<\\/script");
new Function(script);

html = html
  .replace(/\s*<link rel="manifest"[^>]*>/g, "")
  .replace(/\s*<link rel="(?:icon|apple-touch-icon)"[^>]*>/g, "")
  // Replacement callbacks preserve literal dollar signs from application source.
  .replace('<link rel="stylesheet" href="src/styles.css">', () => `<style>${css}</style>`)
  .replace("<title>UCHIHA RADIUS · المزود</title>", "<title>UCHIHA RADIUS · معاينة تفاعلية</title>")
  .replace('<div id="demo-login" class="demo-login" hidden>', '<div id="demo-login" class="demo-login">')
  // Classic inline scripts work when Android opens a downloaded HTML file through a content:// URI.
  .replace('<script type="module" src="src/app.js"></script>', () => `<script>${script}</script>`);

const navigation = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
const bottomButtons = navigation.match(/class="nav-button/g)?.length ?? 0;
const telegramEntrypoints = html.match(/data-view="telegram"/g)?.length ?? 0;
if (bottomButtons !== 5) throw new Error(`Preview must contain exactly 5 bottom buttons; found ${bottomButtons}`);
if (!html.includes("grid-template-columns: repeat(5")) throw new Error("Preview bottom navigation must remain a single five-column row");
if (!html.includes('id="subscription-strip"')) throw new Error("Preview is missing the fixed top subscription strip");
if (!html.includes('id="demo-login"') || !html.includes('id="dev-login"')) throw new Error("Preview is missing the one-click demo login");
if (html.includes('script type="module"')) throw new Error("Preview must use a content-URI-compatible classic script");
const embeddedScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!embeddedScript) throw new Error("Preview is missing its embedded application script");
new Function(embeddedScript);
if (telegramEntrypoints !== 1) throw new Error(`Preview must contain one Telegram entrypoint; found ${telegramEntrypoints}`);
if (/<script[^>]+src=|<link[^>]+href=/i.test(html)) throw new Error("Preview must not depend on external scripts or styles");
if (html.includes("radius.example.com")) throw new Error("Preview contains a deployment placeholder domain");

fs.writeFileSync(output, html);
console.log(`Standalone preview created: ${output}`);
