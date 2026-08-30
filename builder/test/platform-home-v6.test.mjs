import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);
const readPublic = (name) => readFile(new URL(name, publicUrl), "utf8");

test("UCHIHA Builder is the only approved public platform identity", async () => {
  const [index, platform] = await Promise.all([readPublic("index.html"), readPublic("platform-v5.html")]);
  for (const html of [index, platform]) {
    assert.match(html, /<title>UCHIHA Builder<\/title>/);
    assert.match(html, /class="uchiha-v5(?:\s|\")/);
    assert.match(html, /id="platformPage"/);
    assert.doesNotMatch(html, /v41 Final Demo/i);
    assert.doesNotMatch(html, /data-v41-production-pending/);
  }
  assert.match(index, /platform-v5\.js\?v=2026\.08\.15\.1/);
  assert.match(platform, /platform-v5\.js\?v=2026\.08\.14\.3/);
});

test("Builder runtime connects its carousel, categories and create-store route", async () => {
  const runtime = await readPublic("platform-v5.js");
  assert.match(runtime, /const HOME_SLIDES = Object\.freeze/);
  assert.match(runtime, /image: "\/assets\/marketing-assets\/slide-commerce\.svg"/);
  assert.match(runtime, /image: "\/assets\/marketing-assets\/slide-apps\.svg"/);
  assert.match(runtime, /image: "\/assets\/marketing-assets\/slide-infrastructure\.svg"/);
  assert.match(runtime, /href: "\/create-store"/);
  assert.match(runtime, /slug: "online-stores"[\s\S]*href: "\/create-store"/);
  assert.match(runtime, /CATEGORY_TREE\.filter\(\(category\) => category\.featured !== false\)/);
  assert.match(runtime, /window\.setInterval\(\(\) => show\(activeIndex \+ 1\), 5000\)/);
  assert.match(runtime, /addEventListener\("pointerdown"/);
  assert.match(runtime, /addEventListener\("pointerup"/);
  assert.match(runtime, /document\.addEventListener\("visibilitychange", start\)/);
  assert.match(runtime, /drawerLink\("\/create-store", "إنشاء متجر", "store"\)/);
  assert.match(runtime, /drawerLink\("\/category\/hosting-domains"/);
  assert.match(runtime, /requestJson\("\/api\/public\/portal"\)/);
});

test("Builder chrome keeps UCHIHA framing and accessible motion controls", async () => {
  const [core, polish, language] = await Promise.all([readPublic("platform-v5.css"), readPublic("platform-v5-polish.css"), readPublic("platform-v5-polish.js")]);
  assert.match(core, /\.v5-home-slides\s*\{[\s\S]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(core, /@media \(min-width:\s*720px\)[\s\S]*aspect-ratio:\s*16\s*\/\s*7/);
  assert.match(core, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.v5-home-slide/);
  assert.match(polish, /\.v5-header\s*\{[\s\S]*rgba\(79, 8, 21, \.97\)/);
  assert.match(polish, /\.v5-header-inner\[data-polished="true"\]\s*\{\s*direction:\s*ltr/);
  assert.match(polish, /\.v5-header-controls\s*\{[\s\S]*direction:\s*rtl;[\s\S]*margin-left:\s*auto/);
  assert.match(polish, /\.v5-drawer\s*\{[\s\S]*right:\s*0;[\s\S]*left:\s*auto/);
  assert.match(polish, /\.v5-bottom-nav\s*\{[\s\S]*rgba\(25, 8, 13, \.98\)/);
  assert.match(language, /"إنشاء متجر": "Create a store"/);
  assert.ok(language.includes('"ماذا تريد أن تبني؟": "What do you want to build?"'));
  assert.doesNotMatch(language, /🏠|🤖|📱|🌐|🛒|☁️|✨/u);
});

test("service worker warms the stable Builder cache without retired v41 runtime files", async () => {
  const worker = await readPublic("sw.js");
  assert.match(worker, /const RELEASE_VERSION = "2026\.08\.14\.3"/);
  for (const asset of ["platform-v5.css","platform-v5.js","platform-v5-polish.css","platform-v5-polish.js","marketing-assets/showcase-store.svg","marketing-assets/slide-apps.svg","marketing-assets/slide-commerce.svg","marketing-assets/slide-infrastructure.svg","catalog-assets/social-service.svg","catalog-assets/programming.svg","catalog-assets/ai-chatbot.svg"]) assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  assert.doesNotMatch(worker, /v41-production-bridge\.js/);
  assert.doesNotMatch(worker, /v41-responsive\.css/);
});

test("VPS smoke contract verifies the Builder shell and live backend synchronization", async () => {
  const smoke = await readFile(new URL("../scripts/smoke-vps.sh", import.meta.url), "utf8");
  assert.match(smoke, /PUBLIC_RELEASE="2026\.08\.14\.3"/);
  assert.match(smoke, /<title>UCHIHA Builder<\/title>/);
  assert.match(smoke, /platform-v5\.js/);
  assert.match(smoke, /\/api\/public\/portal/);
  assert.match(smoke, /\/api\/public\/service-requests/);
  assert.match(smoke, /services, payment methods and orders are unified on the Builder shell/);
  assert.doesNotMatch(smoke, /v41-production-bridge\.js/);
  assert.match(smoke, /! grep -qi 'v41 Final Demo'/);
});
