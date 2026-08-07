# UCHIHA Demo Store — Reference UI Handoff

**Branch:** `builder/v1-platform`
**Deployment:** Ubuntu VPS + Docker Compose + PostgreSQL + Caddy
**Public demo:** `/store/demo`
**Owner demo:** `/admin/00000000-0000-4000-8000-000000000102`

## Implemented direction

The permanent demo now uses the real Fastify/PostgreSQL storefront runtime. It no longer redirects to the retired browser-only `demo-store.html` fixture.

The public information architecture closely follows the approved merchant-demo reference while using original UCHIHA code and UCHIHA-owned artwork:

- Read-only demo notice with user/admin links.
- User-login or continue-as-guest welcome dialog.
- Sticky merchant header, account tools, balance, notifications, and drawer.
- Search, rotating banners, announcement strip, root categories, nested categories, and products.
- Consistent 44px primary controls and compact secondary controls.
- Responsive 4/3/2-column catalog grids.
- Mobile bottom navigation, cart, account, orders, wallet, support, and dialogs.
- Centered UCHIHA loader using SVG/CSS only.
- Real light and dark demo palettes.
- Reduced-motion support.

UCHIHA identity changes are demo-only. Other tenant stores continue using their own PostgreSQL design tokens, logos, and colors.

## Persistent demo data

`src/demo-uchiha-branding.mjs` is called from `src/showcase.mjs` during `npm run bootstrap`.

It maintains:

- Store name: `UCHIHA STORE`.
- Three UCHIHA banner records.
- Four active root categories.
- Original SVG category artwork.
- A real `programming_service` demo product.
- Demo-only payment instructions.
- Disabled payment methods and database-enforced read-only order protection.
- Support contact data and working hours.

## Public UI files

- `public/store-reference.css`
- `public/store-reference-runtime.css`
- `public/store-reference-welcome.css`
- `public/store-reference.js`
- `public/demo-assets/uchiha-slide-main.svg`
- `public/demo-assets/uchiha-slide-account.svg`
- `public/demo-assets/uchiha-slide-support.svg`
- `public/demo-assets/uchiha-category-games.svg`
- `public/demo-assets/uchiha-category-subscriptions.svg`
- `public/demo-assets/uchiha-category-digital.svg`
- `public/demo-assets/uchiha-category-services.svg`

## Owner UI files

- `public/admin-reference.css`
- `public/admin-reference.js`
- `public/admin-subpages-reference.css`
- `public/payments-admin.html`

The reference skin covers the core owner panel plus financial administration, support administration, and account/customer-experience settings.

## Runtime and cache

`public/theme.js` loads the reference assets only on matching store/admin routes. `public/sw.js` uses release `2026.08.07.4`, removes older `uchiha-*` caches, and precaches the new CSS/JS/SVG assets.

## Legacy-path cleanup

The initial experimental skin that was placed in the repository's old root Python storefront path was removed. The original legacy Python files were restored, and the active reference-store implementation is now isolated under `builder/`, which is the application deployed by the VPS Docker image.

## Tests

- `test/demo-store-isolated.test.mjs`
- `test/reference-storefront-ui.test.mjs`
- `test/production-demo.test.mjs`

Contracts cover the real demo runtime, no static redirect, centered loader, welcome dialog, control sizing, owner subpages, four PostgreSQL root categories, programming-service product, original SVG assets, PWA entries, and read-only demo safety.

## VPS update

The repository update script already runs `npm run bootstrap` twice, which reapplies migrations and persistent UCHIHA demo branding before the API and worker are recreated.

```bash
sudo /opt/uchiha-builder/repo/builder/scripts/update-vps.sh
```

Do not merge the draft PR or deploy until the Builder workflow completes successfully. No Railway step is part of this deployment.
