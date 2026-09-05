# UCHIHA Control Center Team API

Mobile/Native API used by UCHIHA Control Center Android. It is integrated into Control Center v6 under `/api/mobile/*` by `integrate-v6.js`.

## Security boundary

- Team roles: `OWNER`, `DEVELOPER`, `SUPPORT`.
- Passwords are stored as salted scrypt hashes.
- Session tokens are random and only their SHA-256 hashes are persisted.
- GitHub and server credentials stay in the server-side AES-256-GCM Vault and never return to the APK.
- Source browsing blocks `.env`, credential files, keys, keystores and other secret-like paths.
- Source writes are restricted to `OWNER` / `DEVELOPER` through the `source.write` capability and go to a project-scoped Preview Branch, never Production/default branch.
- Preview builds are restricted to `OWNER` / `DEVELOPER` through `preview.build`.

## Preview modes

### Static source

Repositories with a directly usable `index.html` are rendered through the isolated Preview WebView. External hosts, cookies, file access and other risky WebView capabilities remain blocked.

### Build-required projects

Framework detection is automatic. Current detection includes Vite, React, Next.js, Angular, SvelteKit, Astro and generic Node variants.

The real static Preview Build runner currently supports:

- Vite
- React (`react-scripts`)
- Angular
- Astro

Next.js, SvelteKit and generic Node runtime projects are intentionally not represented as fake static previews.

## alpha12 build execution

`POST /api/mobile/projects/:id/preview/build` creates an isolated `[UCHIHA-PREVIEW]` request in the configured bridge repository. The dedicated `UCHIHA Preview Build` GitHub Actions workflow performs the build on a GitHub-hosted runner. It does not load VPS or Production secrets.

Build protections include:

- Public repositories only in alpha12. Private repositories return `preview_build_private_repo_requires_app` until a scoped GitHub App installation-token flow is implemented.
- Dependency installation runs with lifecycle scripts disabled. It requires outbound network only to fetch dependencies.
- The actual framework build runs with `--network none`.
- The build container uses `--cap-drop ALL`, `no-new-privileges`, non-root UID/GID, CPU/RAM/PID/time limits, no Docker socket, no host network and no Production secrets.
- Committed secret-like files are rejected before build.
- Output symlinks, oversized artifacts and missing `index.html` are rejected.
- Build artifacts are retained for 7 days.
- Result markers are accepted by the Mobile API only when the GitHub comment author is `github-actions[bot]`.
- Build state stored by UCHIHA contains metadata only: request/run/artifact/revision/status; no source content or secrets.

`GET /api/mobile/projects/:id/preview/build` polls the trusted build result and returns `queued`, `ready` or `failed` state.

## Current boundary

alpha12 creates and tracks a real static Preview Build artifact. Serving that artifact back through the Mobile API and rendering it inside the device frame is the next Preview phase; alpha12 does not claim that artifact rendering is already complete.
