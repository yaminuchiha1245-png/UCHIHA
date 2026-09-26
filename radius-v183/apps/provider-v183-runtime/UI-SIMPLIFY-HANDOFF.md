# V1-83 UI simplification — post-merge follow-up

Branch: `radius-v183/ui-simplify` · production deploy: **not performed by the UI workstream**.
Original UI PR [#80](https://github.com/yaminuchiha1245-png/UCHIHA/pull/80) merged into `radius-v183-telegram-integration` at `8445e3a`. The original hash-locked `reference/UCHIHA-RADIUS-UI-V1-83.html` and its artwork remain unchanged.

## Already merged through PR #80
- Responsive mobile layout, compact subscription strip and KPI cards, safe-area-aware five-button bottom navigation, full-width account drawer with seven vertical shortcuts.
- Advanced features remain accessible inside Advanced management. On phones the existing session chart comes before collapsible alerts; the desktop DOM order is restored.
- Authenticated provider name and UCHIHA ID; Telegram ID/name/username/photo only from the verified server response or exact Telegram Mini App `initData` after successful `/auth/telegram` verification. Raw `initDataUnsafe`, mismatched identities and non-Telegram avatars never supply an alleged Telegram identity.
- Navigation uses the existing tenant API and backend permission gates. No router registration is duplicated by a deep link.

## Pending follow-up on this UI branch
1. Fix the narrow-phone KPI grid to use two side-by-side small-stat cards rather than a blank third column (320–390px).
2. Include `ui-deeplink.test.mjs` for the runtime's real allowlisted Telegram Mini App routes, authenticated existing-router `deviceId`, Site Agent, tenant and role checks, and invalid-link rejection.
3. Preserve **all three live network-health indicators** on the dashboard: authentication success, response time and available MikroTik/NAS devices. A previous UI-only CSS rule hid the third row. The updated layout displays three compact columns on phones, including 320px; no API or data transformations were changed.
4. Add a regression test ensuring the final health row is not hidden and the three-column live layout is present.
5. Respect `me.canWrite===true` in both generic and selected-device Site Agent Mini App links, including users whose `role` is owner/admin but whose write access is disabled. The API remains authoritative. Add a regression test for both owner/admin roles with and without `deviceId`.

## Checks and evidence
- After the live-health correction: `node --test apps/provider-v183-runtime/ui-simplify.test.mjs`: **12/12 pass** in the isolated VPS worktree.
- The latest branch's actual `ui-simplify.js`, CSS, and Mini App routing block were fetched from GitHub and exercised using **22/22 isolated V8 source-level checks** with mocked DOM/tenant state (**12 UI/profile/layout + 10 deep-link/permissions**, including the new read-only Site Agent guard). This is **not** an official Node test-runner execution or end-to-end browser test. Earlier isolated VPS `ui-simplify.test.mjs` passed 12/12, and the preceding combined Node suite passed 20/20. Run the now **22-test combined Node suite** from this latest GitHub head, standalone web build, Android asset preparation, and complete project checks before release.
- Headless Chrome 148 visually checked the previous UI commit at **320, 360, 390, 430 and 768px**, using isolated localhost with preview fixtures. Each width showed seven drawer entries; no horizontal overflow, bottom-nav overlap or JavaScript page errors. At 390px the settled drawer was within x=11..375 of the 390px viewport. Screenshots and geometry results were saved outside the repository at `/tmp/uchiha-v183-ui-qa/` on the VPS. **Repeat the browser check after the new health visibility patch** and on physical Android devices; preview fixtures are not live subscriber or router evidence.
- The previous isolated worktree had **336 project files** passing static checks; no claim is made that this follow-up has rerun that check yet. The VPS uses Node 22, while the package declares Node >=24; repeat release checks on Node 24.

## Integration ownership and release gates
- Backend verified Telegram fields: [issue #78](https://github.com/yaminuchiha1245-png/UCHIHA/issues/78). Absence is rendered as unavailable; never invent a user ID/photo.
- Telegram bot workstream and staged runtime are separate; this branch changes no bot, backend, migrations, reference HTML, deployed web assets, or production service.
- Integrator should merge the latest UI follow-up only after verifying base-branch compatibility, use a real authorized signed Telegram Mini App account to check dashboard/subscribe/invoices/existing device deep links, and conduct physical-device visual QA. Real MikroTik management connectivity and subscriber AAA are backend/hardware release gates, not proved by CSS or browser fixture tests.
