# UCHIHA Control Center Android APK

## 2.0.0-rc1

UCHIHA Control Center is a native Android control application for the owner's real projects. The normal application UI does not embed the production website in a WebView; WebView remains limited to the isolated project Preview experience.

### Launch scope

- Native Owner / Developer / Support authentication with server-issued sessions protected locally by Android Keystore.
- Home workspace synchronized from the live Control Center project registry, with offline project cache.
- Projects are rendered as compact horizontal strips instead of oversized cards.
- Project-type artwork is shown at the start of every strip, including a Telegram paper-plane asset for bot projects and dedicated application/project fallbacks.
- Project details include live status, environment, domain, server, release, health and last deployment when provided by the registry.
- The project header returns to the real Home workspace instead of a broken placeholder route.
- GitHub connection, repository discovery, project binding, source browsing and guarded preview-branch edits.
- VPS connection and verification.
- Domain configuration and DNS/HTTPS verification.
- Guarded deployment with Owner approval, health verification and rollback.
- Owner-only project Secrets screen. Secret values can be created, replaced or deleted from the app without opening Terminal.
- Existing secret values are never returned to the Android client; the list endpoint exposes key names and metadata only.
- Project secrets are stored server-side as protected 0600 environment files and are synchronized into the guarded executor only on the VPS.
- AI features are intentionally not part of the Android application.
- No production WebView dependency.

### Security rules

- Passwords are never stored in plaintext on the phone.
- GitHub and server credentials stay encrypted server-side.
- Project secret values are write-only from the mobile app.
- Source browsing blocks secret-like files.
- Production deploy remains approval-gated and health-checked.
- Secrets are never inserted into GitHub issue command payloads.

Package: `com.uchiha.controlcenter`

GitHub Actions runs Team API tests, reconstructs and validates the integrated v6 runtime, smoke-tests the mobile secrets/deploy flow, and builds an installable Android APK for pull requests.
