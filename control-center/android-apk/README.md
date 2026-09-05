# UCHIHA Control Center Android APK

## Native rebuild

The Android application is being rebuilt as a real native team workspace. It no longer uses `panel.uchiha-builder.com` as the application UI and it must not embed the production panel in a WebView.

### Native Phase 1

Implemented on the native development branch:
- Local Android UI shell that renders without loading a domain.
- Project dashboard and local search.
- Project detail screen with only the agreed daily tools: Preview, AI, GitHub, Server, Domain and Deploy.
- Team screen with the deliberately small role model: Owner, Developer and Support.
- Local Preview Sandbox container. It is currently an honest UI container only; the code build/runtime sandbox is the next integration phase.
- VPS connection form shell. SSH execution and encrypted credential storage are not claimed as complete yet.
- No production WebView dependency.

### Next phases

1. Workspace authentication and per-member permissions.
2. Encrypted local cache + secure backend session.
3. GitHub connection and repository/project synchronization.
4. Real Preview Engine that builds project source in an isolated sandbox and streams the preview into the phone frame.
5. Secure VPS connector (SSH), credential vault and connection testing.
6. Domain connection workflow (DNS, reverse proxy, TLS and health verification).
7. AI provider adapters for ChatGPT, Claude and Gemini without exposing provider secrets to other members.
8. Deploy flow with preview/review gate before Production.

### Design direction

The production interface follows the UCHIHA Premium Structured Illustrated UI rules: stable layout, pixel-crisp rendering, calm base surfaces, functional color coding, clear action hierarchy, minimal unnecessary scrolling and purposeful state motion. External service logos must use authentic assets; internal functions will receive a consistent custom illustrated asset family before final visual release.

Package: `com.uchiha.controlcenter`

The existing GitHub Actions workflow builds the installable Android debug APK after accepted changes reach `main`.
