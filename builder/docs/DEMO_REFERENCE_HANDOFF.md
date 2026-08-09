# UCHIHA Demo Store — Reference UI Handoff

**Branch:** `builder/v1-platform`
**Deployment:** Ubuntu VPS + Docker Compose + PostgreSQL + Caddy
**Public demo:** `/store/demo`
**Owner demo:** `/admin/00000000-0000-4000-8000-000000000102`
**Current storefront release:** `2026.08.09.1`

## Implemented direction

The permanent demo uses the real Fastify/PostgreSQL storefront runtime. It does not redirect to the retired browser-only `demo-store.html` fixture.

The public information architecture follows the approved merchant-demo direction while using original UCHIHA code and UCHIHA-owned artwork:

- Read-only demo notice with user/admin links.
- User-login or continue-as-guest welcome dialog.
- Merchant-colored top and bottom chrome only; controls inside keep their own accents instead of inheriting the store color.
- Compact direction-safe mobile header with exactly three controls on the right (menu, compact balance, notifications) and store identity on the left.
- Search with collision-safe input/action/icon columns.
- Four rotating UCHIHA banners: Madara, Obito, Itachi, and Konan.
- Root categories, nested categories, then products; products are not dumped onto the home page.
- Full-color category artwork with neutral card surfaces; category media is not forced to grayscale or merchant tint.
- Drawer routes with per-feature SVG colors, custom currency selector, and compact sun/moon theme switch.
- Responsive mobile bottom navigation with store-colored bar and independently colored icons.
- Centered vector UCHIHA loader with compositor-friendly CSS ring animation.
- Real light and dark palettes and reduced-motion support.

UCHIHA identity media is demo-only. Other tenant stores continue using their own PostgreSQL design tokens, logos, colors, categories, and product data.

## Persistent demo data

`src/demo-uchiha-branding.mjs` is called from `src/showcase.mjs` during `npm run bootstrap`.

It maintains:

- Store name: `UCHIHA STORE`.
- Four active UCHIHA banner records, including Konan.
- Four active root categories plus nested demo categories.
- Full-color UCHIHA-owned SVG category artwork.
- A real `programming_service` demo product.
- Demo-only payment instructions.
- Disabled payment methods and database-enforced read-only order protection.
- Support contact data and working hours.

## Current storefront launch files

- `public/store-launch-v6.css`
- `public/store-launch-v6.js`
- `public/store-category-color-final.css`
- `public/theme.js`
- `public/sw.js`
- `public/store-reference.css`
- `public/store-reference-runtime.css`
- `public/store-reference-welcome.css`
- `public/store-reference.js`

## Current UCHIHA demo media

- `public/demo-assets/uchiha-banner-madara.webp`
- `public/demo-assets/uchiha-banner-obito.webp`
- `public/demo-assets/uchiha-banner-itachi.webp`
- `public/demo-assets/uchiha-banner-konan.svg` (الصورة الجديدة مضمنة، مع نسختي 1280 و1920)
- responsive `-1280` and `-1920` banner variants
- `public/demo-assets/uchiha-category-games-v2.svg`
- `public/demo-assets/uchiha-category-subscriptions-v2.svg`
- `public/demo-assets/uchiha-category-digital-v2.svg`
- `public/demo-assets/uchiha-category-services-v2.svg`
- `public/demo-assets/uchiha-transparent-mark.svg`

## Owner UI files

- `public/admin-reference.css`
- `public/admin-reference.js`
- `public/admin-polish-v2.css`
- `public/admin-catalog-v3.css`
- `public/admin-catalog-v3-runtime.css`
- `public/admin-catalog-v3.js`
- `public/admin-launch-v4.css`
- `public/admin-subpages-reference.css`
- `public/admin-subpages-polish-v2.css`

The owner reference skin covers the core dashboard plus financial administration, support administration, account/customer-experience settings, and catalog surfaces.

## Runtime and cache

`public/theme.js` installs the storefront launch layers only on store routes. The final category-color preservation stylesheet is deliberately loaded after `store-launch-v6.css` so older grayscale/tint rules cannot win the cascade.

Current PWA release markers are `2026.08.09.1`; `sw.js`, `pwa.js`, `runtime-recovery.js`, storefront launch tests, and theme release markers are aligned to that release.

The store shell now links its final storefront CSS and runtime assets directly, using the same marker attributes as `theme.js`. This removes the staged first-paint jump that previously exposed older loader/header geometry on some Android browsers.

## Tests

Relevant contracts include:

- `test/demo-store-isolated.test.mjs`
- `test/reference-storefront-ui.test.mjs`
- `test/production-demo.test.mjs`
- `test/store-launch-v6.test.mjs`
- `test/store-category-color-final.test.mjs`
- `test/pwa-reload-loop.test.mjs`

The newest category-color contract verifies that the final layer loads after the launch stylesheet, removes grayscale/mix-blend filtering, and prevents merchant-color tint from taking over category surfaces.

## CI state at continuation

GitHub Actions jobs for both `UCHIHA Builder V1` and `Fable5 Validate and Package` are currently ending before any workflow step is exposed: the jobs return an empty step list, no validation artifact is produced, and the downloadable job-log blob is unavailable. Because execution never reaches checkout/install/test steps, do not treat those runs as evidence of a source-code assertion failure.

Do not weaken or delete project tests merely to make this state appear green. Re-run CI when GitHub Actions begins executing steps normally.

## VPS update

The repository update script runs `npm run bootstrap` twice, which reapplies migrations and persistent UCHIHA demo branding before the API and worker are recreated.

```bash
sudo /opt/uchiha-builder/repo/builder/scripts/update-vps.sh
```

Do not merge the draft PR or deploy until the Builder workflow actually executes its steps and completes successfully. No Railway deployment step belongs to this Builder release path.
