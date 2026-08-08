import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const publicUrl = new URL("../public/", import.meta.url);
const sourceUrl = new URL("../src/", import.meta.url);

const publicSource = (name) => readFile(new URL(name, publicUrl), "utf8");
const source = (name) => readFile(new URL(name, sourceUrl), "utf8");

test("launch storefront keeps precise RTL controls, collision-free search, merchant colors, and a half-screen drawer", async () => {
  const [css, runtime, theme, worker] = await Promise.all([
    publicSource("store-launch-v6.css"),
    publicSource("store-launch-v6.js"),
    publicSource("theme.js"),
    publicSource("sw.js")
  ]);

  assert.match(css, /--launch-control:\s*44px/);
  assert.match(css, /--launch-gap:/);
  assert.match(css, /#storeMoreTrigger\s*\{\s*order:\s*1/);
  assert.match(css, /#storeGuestLogin\s*\{\s*order:\s*2/);
  assert.match(css, /#storeBalanceLink\s*\{\s*order:\s*3/);
  assert.match(css, /#storeNotificationsLink\s*\{\s*order:\s*4/);
  assert.match(css, /store-language-toggle\s*\{\s*order:\s*5/);
  assert.match(css, /#storeBuyerLevel/);
  assert.match(css, /grid-template-areas:\s*"submit clear input icon"/);
  assert.match(css, /\.store-main-search input[\s\S]*position:\s*relative\s*!important/);
  assert.match(css, /--launch-brand/);
  assert.match(css, /\.store-mobile-nav[\s\S]*var\(--launch-brand/);
  assert.match(css, /data-account-route="security"[\s\S]*#4ade80/);
  assert.match(css, /launch-theme-knob/);
  assert.match(css, /translate3d\(-28px,0,0\)/);
  assert.match(css, /launch-drawer-currency-popover/);
  assert.match(css, /aspect-ratio:\s*1\s*\/\s*1/);
  assert.match(css, /\.store-more-dialog\[open\][\s\S]*width:\s*min\(420px,\s*50vw\)/);
  assert.match(css, /@media \(max-width:\s*680px\)[\s\S]*width:\s*50vw/);
  assert.match(css, /translate3d/);
  assert.match(css, /demo-development-card/);
  assert.match(css, /content-visibility:\s*auto/);
  assert.doesNotMatch(css, /backdrop-filter:\s*blur/);
  assert.match(css, /prefers-reduced-motion/);

  assert.match(runtime, /WHATSAPP_URL = "https:\/\/wa\.me\/963942586044"/);
  assert.match(runtime, /uchiha-banner-madara\.webp/);
  assert.match(runtime, /uchiha-banner-obito\.webp/);
  assert.match(runtime, /uchiha-banner-itachi\.webp/);
  assert.match(runtime, /demoBannerNames = \["madara", "obito", "itachi", "konan"\]/);
  assert.match(runtime, /"-1280\." \+ extension/);
  assert.match(runtime, /removeDevelopmentPreview/);
  assert.match(runtime, /launch-currency-dialog/);
  assert.match(runtime, /launch-fab-toggle/);
  assert.match(runtime, /anchor\.id = "storeFloatingWhatsapp"/);
  assert.match(runtime, /launch-fab-support-icon/);
  assert.match(runtime, /enhanceBuyerLevels/);
  assert.match(runtime, /enhanceThemeToggle/);
  assert.match(runtime, /enhanceDrawerCurrency/);
  assert.match(runtime, /M6 12h\.01M12 12h\.01M18 12h\.01/);
  assert.match(runtime, /name\.id = "footerStoreName"/);
  assert.match(runtime, /MutationObserver/);
  assert.doesNotMatch(runtime, /[😀-🙏🌀-🿿]/u);

  assert.match(theme, /store-launch-v6\.css/);
  assert.match(theme, /store-launch-v6\.js/);
  assert.match(theme, /2026\.08\.08\.21/);
  assert.match(theme, /return kind !== "store" && kind !== "account"/);
  assert.match(worker, /store-launch-v6\.css/);
  assert.match(worker, /store-launch-v6\.js/);
  assert.match(worker, /uchiha-banner-konan-1280\.svg/);
  assert.match(worker, /2026\.08\.08\.21/);
});

test("demo launch media is populated, crisp, UCHIHA-owned, and cacheable", async () => {
  const [branding, games, subscriptions, digital, services, mark] = await Promise.all([
    source("demo-uchiha-branding.mjs"),
    publicSource("demo-assets/uchiha-category-games-v2.svg"),
    publicSource("demo-assets/uchiha-category-subscriptions-v2.svg"),
    publicSource("demo-assets/uchiha-category-digital-v2.svg"),
    publicSource("demo-assets/uchiha-category-services-v2.svg"),
    publicSource("demo-assets/uchiha-transparent-mark.svg")
  ]);

  for (const svg of [games, subscriptions, digital, services, mark]) {
    assert.match(svg, /<svg/);
    assert.doesNotMatch(svg, /ahminix/i);
  }

  for (const name of ["madara", "obito", "itachi"]) {
    const file = new URL(`demo-assets/uchiha-banner-${name}.webp`, publicUrl);
    const info = await stat(file);
    assert.ok(info.size > 100_000, `${name} banner must contain production artwork`);
    for (const width of [1280, 1920]) {
      const responsive = await stat(new URL(`demo-assets/uchiha-banner-${name}-${width}.webp`, publicUrl));
      assert.ok(responsive.size > 20_000, `${name} ${width}px banner must contain production artwork`);
      assert.ok(responsive.size < info.size, `${name} ${width}px banner must be lighter than the 4K source`);
    }
    assert.match(branding, new RegExp(`uchiha-banner-${name}\\.(?:webp|svg)`));
  }

  const konanMaster = await publicSource("demo-assets/uchiha-banner-konan.svg");
  assert.match(konanMaster, /viewBox="0 0 3840 2160"/);
  assert.match(konanMaster, /data:image\/webp;base64,UklGR/);
  assert.doesNotMatch(konanMaster, /ahminix/i);
  for (const width of [1280, 1920]) {
    const responsive = await stat(new URL(`demo-assets/uchiha-banner-konan-${width}.svg`, publicUrl));
    assert.ok(responsive.size > 80_000, `konan ${width}px banner must contain production artwork`);
  }
  assert.match(branding, /uchiha-banner-konan\.svg/);

  assert.match(branding, /uchiha-category-games-v2\.svg/);
  assert.match(branding, /uchiha-category-services-v2\.svg/);
  assert.match(branding, /https:\/\/wa\.me\/963942586044/);
  assert.match(branding, /DEMO_CURRENCIES/);
  assert.match(branding, /INSERT INTO store_banners/);
  assert.match(branding, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(branding, /primary_color='#b31230'/);
  assert.equal((branding.match(/mediaUrl:/g) || []).length, 4);
});
