# UCHIHA Control Center Android APK

## Native rebuild

The Android application is being rebuilt as a real native team workspace. It no longer uses `panel.uchiha-builder.com` as the application UI and it must not embed the production panel in a WebView.

### Implemented through `2.0.0-alpha03`

- Local Android UI shell that renders without loading a domain.
- Personal team login for Owner / Developer / Support.
- Server-issued sessions encrypted locally with Android Keystore; passwords are never stored on the device.
- Role capabilities control which project tools are visible.
- Owner team-management screen for listing and creating members.
- Project dashboard synchronized from the existing Control Center v6 live registry through the Team API.
- Per-member local project cache so the last synchronized workspace remains readable offline.
- Project detail view with status, environment, domain, server, release, health score and last deployment when available.
- Project tools are deliberately limited to the agreed daily set: Preview, AI, GitHub, Server, Domain and Deploy.
- Local Preview Sandbox phone container. It is an honest UI container only; the isolated code build/runtime engine is not claimed as complete yet.
- No production WebView dependency.

### Next phases

1. Deploy the Team API behind the existing HTTPS reverse proxy and point it at the production v6 `state.json` registry.
2. GitHub connection and repository/source synchronization from inside the APK.
3. Real Preview Engine that builds project source in an isolated sandbox and streams the preview into the phone frame.
4. Secure VPS connector (SSH), credential vault and connection testing.
5. Domain connection workflow (DNS, reverse proxy, TLS and health verification).
6. AI provider adapters for ChatGPT, Claude and Gemini without exposing provider secrets to other members.
7. Deploy flow with preview/review gate before Production.
8. Replace alpha emoji placeholders with the final UCHIHA custom illustrated asset family and run visual QA.

### Design direction

The production interface follows the UCHIHA Premium Structured Illustrated UI rules: stable layout, pixel-crisp rendering, calm base surfaces, functional color coding, clear action hierarchy, minimal unnecessary scrolling and purposeful state motion. External service logos must use authentic assets; internal functions will receive a consistent custom illustrated asset family before final visual release.

Package: `com.uchiha.controlcenter`

GitHub Actions validates the Team API and builds an installable Android debug APK for pull requests before changes are merged to `main`.
