# V1-83 UI simplification — merge handoff

Branch: `radius-v183/ui-simplify`
Initial base on the isolated VPS worktree: `7f460c4e5ddd61b12c2e8122057c112df9f2104a`. The integration branch subsequently received the independent Telegram-bot PR #79 (`951f92ba7497420d0ac2ccf1e1c54858b5e1f6c6`), which touches only bot files and can be merged without changing this UI scope.

## UI scope
- Retain the hash-locked V1-83 visual reference, feature artwork, all routes and existing live data/connection guards.
- `ui-simplify.css`: compact mobile header, subscription strip, dashboard metrics, session summary, safe-area-aware five-action bottom nav, and a full-width usable account drawer.
- `ui-simplify.js`: seven concise vertical menu entries; direct shortcuts for add MikroTik/add subscriber; restore former drawer-only features inside Advanced management. On phones the original session chart moves before collapsible alerts; on desktop its original order returns.
- The drawer renders `user.id` as UCHIHA ID. Telegram fields come from verified server data when available, or from the exact Telegram Mini App `initData` only after the API's `/auth/telegram` request succeeds. Unsigned `initDataUnsafe` is never trusted, and mismatched IDs never substitute a different Telegram profile. Unavailable fields display a clear fallback. User and tenant labels are no longer overwritten by static preview translations.
- Registered routers and verified network connectivity remain separately labeled by the existing API-backed dashboard and diagnostics. No sample values introduced.

## Build and tests
- `node --test apps/provider-v183-runtime/ui-*.test.mjs`: 20 passing UI and Mini App route tests, including identity spoofing, Google-avatar isolation, breakpoint restoration, Telegram bot dashboard/subscribers/invoices routes, existing-router `deviceId` checks, Site Agent links, permissions and invalid-link rejection. These exercise the real runtime route table without inventing device records.
- `node scripts/build-provider-v183.mjs server`: standalone provider HTML and bundled JavaScript.
- `npm run mobile:prepare`: standalone Android web assets; requires the existing root dependencies installed.
- `node scripts/check.mjs`: project static checks after the normal mobile asset preparation.
- Browser screenshot smoke testing started in isolated localhost using cached Chrome, but the full mobile/tablet/desktop visual test did not finish on the memory-constrained production VPS; complete interactive visual QA on a dedicated test machine before merge.

## Coordination and merge
- Backend contract: https://github.com/yaminuchiha1245-png/UCHIHA/issues/78
- Frontend source changes only: `apps/provider-v183-runtime/` and its UI bundling in `scripts/build-provider-v183.mjs`.
- The integration branch on the VPS held **29 additional local commits** relative to `origin/radius-v183-telegram-integration` when this work began. Merge this UI commit only after the integration owner reconciles those base commits. Do not mistake the resulting branch compare for UI-only changes until then.
- Not published to the production site. No bot, API, database or production service changed.
