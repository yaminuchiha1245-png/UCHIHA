# UCHIHA RADIUS Android shell — v101 baseline

This Android project intentionally does **not** rebuild or replace the existing UCHIHA RADIUS UI.

Runtime order:
1. If `app/src/main/assets/RADIUS-A-Master-v101.html` exists, the APK loads that exact bundled Master v101 UI locally inside the app.
2. If the bundled file is not present, the APK falls back only to the production URL `https://radius.uchiha-builder.com/`.

ChatGPT-hosted preview URLs are forbidden in provider APK builds and CI fails if one is introduced under the Android project.

Production build URL:
`https://radius.uchiha-builder.com/`

Build:

```bash
gradle :app:assembleDebug -PuchihaRadiusUrl=https://radius.uchiha-builder.com/
```

The shell blocks cleartext HTTP, disables file/content access, accepts first-party cookies, keeps only the production UCHIHA RADIUS host inside the WebView, and sends external links to Android.

The bundled HTML is loaded with the production HTTPS URL as its base URL, so the existing v101 layout can remain unchanged while native Android capabilities are injected through `window.UchihaProviderApp`.

Provider-ready MikroTik provisioning, activation verification, accounting/quota enforcement, and live controls remain backend-gated and must use the exact v37 production connector. Router mutation is not enabled until backup -> staged apply -> verify -> rollback is implemented and tested.
