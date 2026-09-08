# MAX_HANDOFF — UCHIHA Builder

**Branch:** `builder/v1-platform`
**Base:** `c4ad865d99096228067553b2ca159bd891c3bcbb`
**Date:** 2026-08-02
**Scope:** فحص وإصلاح وظيفي فقط؛ لا redesign، لا `main`، لا PR merge.

## الخلاصة

المشروع Node.js 22/Fastify 5 ESM، واجهته HTML/CSS/Vanilla JS متعددة الصفحات، وقاعدته PostgreSQL. يوجد Worker مستقل، Caddy مولّد وقت النشر، Docker Compose، PWA، وCapacitor Android/iOS. متجر `demo` PostgreSQL حقيقي؛ `showcase.mjs` و`seed.mjs` يضمنانه، و`022_demo_store_safety.sql` يمنع ماليًا الطلبات والإيداعات والمحفظة وأوامر المزود. لا تستبدله ببيانات متصفح.

تم إصلاح `/login` و`/account`، password reveal، الضغط المكرر، Idempotency retry، RTL/LTR التقني، والكاش. الإصلاح في `public/functional-hardening.js` كي يبقى التصميم الحالي بلا إعادة بناء.

## خريطة المشروع

```text
builder/
├─ public/
│  ├─ index.html + marketing.js/css       الصفحات العامة وHeader/Footer/menu
│  ├─ builder.html + app.js               /create-store /login /account
│  ├─ store.html + app.js                 /store/:slug
│  ├─ admin.html + app.js                 لوحة صاحب المتجر
│  ├─ account.html/js/css                 حساب عميل المتجر
│  ├─ platform-admin.html/js/css          مدير المنصة
│  ├─ styles.css → ui-v2.css → platform-v3.css
│  └─ sw.js, pwa.js, manifest.webmanifest
├─ src/
│  ├─ app.mjs, db.mjs, config.mjs
│  ├─ worker.mjs, worker-runner.mjs
│  ├─ payments.mjs, storefront-account.mjs, storefront-api.mjs
│  ├─ portal.mjs, providers.mjs
│  ├─ showcase.mjs, seed.mjs
│  └─ http-hardening.mjs, smoke.mjs, production-readiness.mjs
├─ migrations/  (22)
├─ test/        (node:test + PostgreSQL integration)
├─ scripts/     (VPS/Caddy/backup/restore/smoke/update)
├─ mobile/      (Capacitor Android/iOS)
├─ docker-compose.yml
└─ Dockerfile
```

## التقنية والتشغيل

| Area | Current |
|---|---|
| Frontend | HTML + Vanilla JS + CSS يدوي، ليس React/Vue/Next |
| Backend | Fastify `5.10.0`, Node `>=22`, ESM |
| DB | PostgreSQL 16, `pg 8.22.0`, 22 migrations, RLS/scope constraints |
| Test DB | `pg-mem` للـpreview/unit فقط |
| Worker | `src/worker-runner.mjs` |
| HTTPS | Caddy 2 + PostgreSQL-backed `tls-ask` |
| Deploy | Docker + Compose مولّد + rollback-aware `update-vps.sh` |
| Tests | `node:test`; Playwright غير مثبت بالمشروع |

```bash
cd builder
npm ci
cp .env.example .env
npm run bootstrap
npm start                 # terminal 1
npm run worker            # terminal 2
```

```bash
docker compose up -d --build
docker compose exec -T api npm run bootstrap
docker compose exec -T api npm run bootstrap   # migration pass 2
docker compose exec -T api npm run verify:production
```

```bash
npm test
npm run check
npm run lint
npm run build
npm run verify:production
SMOKE_BASE_URL=http://127.0.0.1:4100 npm run smoke:production
```

Browser sizes: `320,360,375,390,412,430` × `844`; تحقق من `scrollWidth <= clientWidth`, console errors, clickability, fixed overlays, dialogs وkeyboard.

## ملفات الواجهة المهمة

- Public Header/Footer/drawer: `marketing.js:renderShell()/navigation()` + `marketing.css`.
- Builder/Login: `builder.html`, `app.js:initBuilder()`, و`functional-hardening.js`.
- Store: `store.html`, `app.js:initStore()`؛ Header/BottomNav/dialogs داخل HTML.
- Owner: `admin.html`, `app.js:initAdmin()`؛ payments/account صفحات منفصلة.
- Customer: `account.html/js/css`.
- Platform admin: `platform-admin.html/js/css`.
- Service Worker: `public/sw.js`; registration: `public/pwa.js`.

## الألوان والمكونات

لا يوجد Token source واحد: `styles.css` بنفسجي (`--brand:#6d28d9`)، `marketing.css` Burgundy (`--primary:#781b2b`)، وStore tokens ديناميكية (`--store-*`) من PostgreSQL عبر `app.js`. توجد roots إضافية في account/payments/ui-v2. الخط System Stack.

نحو 8,300 سطر CSS متراكب. التصادم الأهم: `.button`, `.builder-shell`, `.dashboard-*`, `.store-header`, `.store-mobile-nav`, `.store-category-*`, `.store-product-*`, `.tabs`, `.field`, `.notice`, `.dialog-close`. هذا مصدر «واجهة داخل واجهة».

Reusable families: Marketing buttons/header/footer/dialog/service-card؛ Builder `step-card/form-grid/field/notice/dashboard-shell/status-badge`؛ Store `store-header/category-card/product-card/mobile-nav/more-dialog`؛ Account `card/status-pill/filter-bar/bottom-nav/bottom-sheet`. لا تنشئ Design System ضخمًا؛ وحّدها تدريجيًا.

## PostgreSQL/demo/Caddy

- `001–002` core/RLS؛ `003–008` wallet/payment؛ `009–010` intelligence؛ `011–014` account/security/API؛ `015–017` portal/support/orders؛ `018–021` hardening/config/scope؛ `022` demo DB guard.
- `/store/demo` مسجل في `app.mjs` ويخدم `store.html`؛ البيانات من PostgreSQL.
- زر demo يثبت `href=/store/demo` في `preview-banner.js`.
- `render-vps-runtime.sh` يحول root subdomain إلى `/store/{slug}`؛ `tls-ask` يسمح فقط active/verified.
- `demo.uchiha-builder.com` يحتاج DNS إلى VPS وصف domain active. تعذر التحقق الحي بسبب `ERR_BLOCKED_BY_ADMINISTRATOR`؛ الكود لا يصلح DNS مفقودًا.

## PWA

Release/Cache: `2026.08.02.2` / `uchiha-shell-2026.08.02.2`. القيم موحدة في `sw.js,pwa.js,preview-banner.js,functional-hardening.js,http-hardening.mjs,smoke.mjs` والاختبارات. `activate` يحذف `uchiha-*` القديمة؛ HTML/CSS/JS network-first/no-store؛ registration يستخدم `updateViaCache:none` و`SKIP_WAITING`. الـhardening asset ضمن precache.

## الإصلاحات

1. `/login` و`/account`: login tab/title/form صحيح حتى مع تأخر API.
2. runtime password toggles مع `aria-controls/aria-pressed`.
3. capture guard للنماذج الأربعة؛ double tap لا يكرر الطلب.
4. store/order Idempotency: network failure يحتفظ بالمفتاح؛ 4xx يمسحه.
5. email/tel/url/password LTR و`unicode-bidi:plaintext`, wrap, `min-width:0` مع بقاء RTL.
6. PWA release bump + precache.
7. `test/ui-functional-hardening.test.mjs` (6 tests).
8. `docs/current-ui-audit/`: screenshots/metrics/runtime results.

## المتروك للتصميم

Header داخل Header، nested cards، كثرة/اختلاف الأزرار، الصفحة الرئيسية الطويلة، تكرار الأقسام، BottomNav/Safe Area، Modal/BottomSheet/z-index، كثافة لوحتي owner/platform، RTL البصري، وتوحيد tokens/spacing/radius. لا تحذف CSS layer دفعة واحدة؛ رحّل selector families مع computed-style checks.

## صور الفحص

`docs/current-ui-audit/`: Home عند المقاسات الستة، وLogin/Create Store/Demo/Platform Admin عند 390px، إضافة إلى `source-audit-before.json` الذي يسجل 18 صفحة/مقاس، و`auth-runtime-after.json`, `auth-runtime-390x844-after.svg`, `functional-guard-runtime.json`.

الصور source-render من ملفات الـCommit مع CSS مضمّن؛ API معطل ولم تُحقن بيانات وهمية. ليست إثبات DNS/PostgreSQL حي.

## لا تحذف

`migrations/001..022`، `showcase.mjs`, `seed.mjs`, `docker-compose.yml`, `Dockerfile`, `render-vps-runtime.sh`, `update-vps.sh`, backup/restore/smoke، PostgreSQL/Caddy volumes، TLS lookup، Worker/provider idempotency/fail-closed. الأسرار ENV فقط.

## المخاطر

DNS أو domain غير active يمنع subdomain/TLS؛ CSS المتأخر قد يغطي أي fix؛ asset بلا release bump يبقي Android قديمًا؛ pg-mem ليس إثبات RLS/triggers؛ حماية demo في migration لا الواجهة.

## نتائج الاختبار

- Base CI artifact `c4ad865`: **66/66**؛ PostgreSQL + **22 migrations**؛ public routes و`/store/demo` ليست 404؛ demo واحد/domain active/payments disabled؛ migration 022 رفض order؛ backup/log موجودان.
- بعد الإصلاح: check **70**، lint **151**، build **138**، focused tests **6/6**.
- Browser auth: **6/6 widths**, toggle=2, LTR صحيح، **0 JS errors/overflow**.
- Submit harness: double tap = **1 handler/1 request**؛ network retry نفس key؛ 4xx key جديد؛ **0 JS errors**.
- Full local test: **50 discovered, 39 pass, 11 loader failures** بسبب npm mirror 404 لـ`yargs-parser-18.1.3.tgz` وعدم توفر `fastify/pg`؛ ليست assertion failures.
- `verify:production` شُغّل وأعاد `DATABASE_URL is required`؛ لم تُستخدم DB وهمية.
- Docker/psql غير مثبتين، لذا image/Compose/restart/migrations/live verify مؤجلة لـCI/VPS.

## تحديث VPS

```bash
sudo /opt/uchiha-builder/repo/builder/scripts/update-vps.sh
```

## جميع المسارات (163)

### src/app.mjs (62)
```text
GET /
GET /account
GET /admin/:storeId
GET /admin/:storeId/product-intelligence
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/register
GET /api/library/categories
GET /api/library/programming-services
GET /api/library/providers
GET /api/library/services
GET /api/me
POST /api/platform/programming-services
POST /api/platform/provider-orders/:providerOrderId/cancel
POST /api/platform/providers/:providerId/sync
PUT /api/platform/subscription-offer
GET /api/projects
GET /api/projects/:projectId
POST /api/projects/:projectId/components
GET /api/public/config
GET /api/public/service-catalog
GET /api/storefront/:slug
POST /api/storefront/:slug/orders
GET /api/stores
POST /api/stores
GET /api/stores/:storeId
PUT /api/stores/:storeId/banner
POST /api/stores/:storeId/bots
GET /api/stores/:storeId/categories
POST /api/stores/:storeId/categories
PUT /api/stores/:storeId/currencies/:currency
PUT /api/stores/:storeId/design
POST /api/stores/:storeId/library/import
GET /api/stores/:storeId/orders
GET /api/stores/:storeId/product-analysis
PUT /api/stores/:storeId/product-analysis/:analysisId/review
POST /api/stores/:storeId/product-analysis/analyze-missing
GET /api/stores/:storeId/products
POST /api/stores/:storeId/products
POST /api/stores/:storeId/products/:productId/analyze
PATCH /api/stores/:storeId/products/:productId/media
POST /api/stores/:storeId/programming-services/import
GET /api/stores/slug/:slug/availability
GET /api/subscription-offer
POST /api/subscriptions/demo-activate
GET /contact
GET /create-store
GET /health
GET /login
GET /payment-methods
GET /platform-admin
GET /privacy
GET /ready
GET /services
GET /showcase
GET /store/:slug
GET /support
GET /sw.js
GET /terms
GET /uchiha-api
POST /webhooks/providers/:providerId
POST /webhooks/telegram/:connectionId
```
### src/payments.mjs (36)
```text
GET /admin/:storeId/payments
GET /admin/:storeId/support
GET /api/public/stores/:slug/customer/me
GET /api/public/stores/:slug/customer/orders
POST /api/public/stores/:slug/customers/login
POST /api/public/stores/:slug/customers/login/totp
POST /api/public/stores/:slug/customers/logout
POST /api/public/stores/:slug/customers/register
POST /api/public/stores/:slug/deposits
POST /api/public/stores/:slug/orders/wallet
GET /api/public/stores/:slug/payment-methods
GET /api/public/stores/:slug/support
POST /api/public/stores/:slug/support
GET /api/public/stores/:slug/support/:threadId/messages
POST /api/public/stores/:slug/support/:threadId/messages
GET /api/public/stores/:slug/wallet
GET /api/stores/:storeId/admin-notifications
POST /api/stores/:storeId/admin-notifications/read
GET /api/stores/:storeId/audit-logs
GET /api/stores/:storeId/customers
PUT /api/stores/:storeId/customers/:customerId
POST /api/stores/:storeId/customers/:customerId/wallet-adjustments
GET /api/stores/:storeId/deposits
POST /api/stores/:storeId/deposits/:depositId/review
GET /api/stores/:storeId/financial/orders
POST /api/stores/:storeId/financial/orders/:orderId/refund
PUT /api/stores/:storeId/financial/orders/:orderId/status
GET /api/stores/:storeId/payment-methods
POST /api/stores/:storeId/payment-methods
PUT /api/stores/:storeId/payment-methods/:methodId
GET /api/stores/:storeId/support
GET /api/stores/:storeId/support/:threadId/messages
POST /api/stores/:storeId/support/:threadId/messages
PUT /api/stores/:storeId/support/:threadId/status
GET /store/:slug/support
GET /store/:slug/wallet
```
### src/portal.mjs (15)
```text
POST /api/platform/banners
PUT /api/platform/banners/:bannerId
POST /api/platform/contact-methods
PUT /api/platform/contact-methods/:contactId
POST /api/platform/payment-methods
PUT /api/platform/payment-methods/:methodId
GET /api/platform/portal
POST /api/platform/providers
PUT /api/platform/providers/:providerId
PUT /api/platform/service-requests/:requestId/status
POST /api/platform/services
PUT /api/platform/services/:serviceId
GET /api/public/payment-methods/:methodId/qr.svg
GET /api/public/portal
POST /api/public/service-requests
```
### src/storefront-account.mjs (38)
```text
GET /admin/:storeId/account-settings
GET /api/public/stores/:slug/account-shell
GET /api/public/stores/:slug/customer/orders/:orderId
GET /api/public/stores/:slug/deposits
GET /api/public/stores/:slug/deposits/:depositId
GET /api/public/stores/:slug/identity
PUT /api/public/stores/:slug/identity
GET /api/public/stores/:slug/identity/files/:kind
POST /api/public/stores/:slug/identity/submit
GET /api/public/stores/:slug/security
POST /api/public/stores/:slug/security/password
DELETE /api/public/stores/:slug/security/sessions/:sessionId
POST /api/public/stores/:slug/security/sessions/logout-others
POST /api/public/stores/:slug/security/totp/disable
POST /api/public/stores/:slug/security/totp/enable
POST /api/public/stores/:slug/security/totp/setup
DELETE /api/public/stores/:slug/telegram-link
GET /api/public/stores/:slug/telegram-link
POST /api/public/stores/:slug/telegram-link
GET /api/stores/:storeId/experience-settings
PUT /api/stores/:storeId/experience-settings
GET /api/stores/:storeId/identity-requests
GET /api/stores/:storeId/identity-requests/:requestId
GET /api/stores/:storeId/identity-requests/:requestId/files/:kind
POST /api/stores/:storeId/identity-requests/:requestId/review
GET /api/stores/:storeId/support-channels
POST /api/stores/:storeId/support-channels
DELETE /api/stores/:storeId/support-channels/:channelId
PUT /api/stores/:storeId/support-channels/:channelId
POST /api/telegram/stores/:storeId/link-codes
GET /store/:slug/about
GET /store/:slug/account
GET /store/:slug/developer
GET /store/:slug/identity
GET /store/:slug/orders
GET /store/:slug/payments
GET /store/:slug/security
GET /store/:slug/telegram
```
### src/storefront-api.mjs (12)
```text
DELETE /api/public/stores/:slug/developer-key
GET /api/public/stores/:slug/developer-key
POST /api/public/stores/:slug/developer-key
GET /api/stores/:storeId/api-keys
POST /api/stores/:storeId/api-keys
DELETE /api/stores/:storeId/api-keys/:keyId
GET /api/v1/categories
GET /api/v1/products
GET /api/v1/products/:productId
GET /api/v1/stores/:slug/categories
GET /api/v1/stores/:slug/products
GET /api/v1/stores/:slug/products/:productId
```

## للنموذج التالي

اقرأ هذا الملف والصور أولًا؛ لا تعِد اكتشاف Backend؛ وحّد المكونات تدريجيًا؛ اختبر PostgreSQL حقيقيًا والمقاسات الستة؛ حافظ على demo/migrations/Compose/Caddy/update-vps؛ وارفع Release عند أي public asset change.
