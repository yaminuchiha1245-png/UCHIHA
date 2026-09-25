# V1-83 UI simplification — merge handoff

Branch: `radius-v183/ui-simplify`
Base on the isolated VPS worktree: `7f460c4e5ddd61b12c2e8122057c112df9f2104a` (`radius-v183-telegram-integration`).

## UI scope
- Retain the hash-locked V1-83 visual reference, feature artwork, all routes and existing live data/connection guards.
- `ui-simplify.css`: compact mobile header, subscription strip, dashboard metrics, session summary, safe-area-aware five-action bottom nav, and a full-width usable account drawer.
- `ui-simplify.js`: seven concise vertical menu entries; direct shortcuts for add MikroTik/add subscriber; restore former drawer-only features inside Advanced management.
- The drawer renders `user.id` as UCHIHA ID. Telegram fields come from verified server data when available, or from the exact Telegram Mini App `initData` only after the API's `/auth/telegram` request succeeds. Unavailable fields display a clear fallback.
- Registered routers and verified network connectivity remain separately labeled by the existing API-backed dashboard and diagnostics. No sample values introduced.

## Build and tests
- `node --test apps/provider-v183-runtime/ui-simplify.test.mjs`: seven UI behavior/identity/layout checks.
- `node scripts/build-provider-v183.mjs server`: standalone provider HTML and bundled JavaScript.
- `npm run mobile:prepare`: standalone Android web assets; requires the existing root dependencies installed.
- `node scripts/check.mjs`: project static checks after the normal mobile asset preparation.

## Coordination and merge
- Backend contract: https://github.com/yaminuchiha1245-png/UCHIHA/issues/78
- Frontend source changes only: `apps/provider-v183-runtime/` and its UI bundling in `scripts/build-provider-v183.mjs`.
- The integration branch on the VPS held **29 additional local commits** relative to `origin/radius-v183-telegram-integration` when this work began. Merge this UI commit only after the integration owner reconciles those base commits. Do not mistake the resulting branch compare for UI-only changes until then.
- Not published to the production site. No bot, API, database or production service changed.
