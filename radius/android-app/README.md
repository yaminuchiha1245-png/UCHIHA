# UCHIHA RADIUS Android shell — v101 baseline

This Android project intentionally does **not** rebuild or replace the existing UCHIHA RADIUS UI. It loads the exact current v101 web surface and acts as the Android packaging layer.

Default preview URL:
`https://uchiha-radius-demo.yaminuchiha1245.chatgpt.site/`

Production build URL:
`https://radius.uchiha-builder.com/`

Build with a selected URL:

```bash
gradle :app:assembleDebug -PuchihaRadiusUrl=https://uchiha-radius-demo.yaminuchiha1245.chatgpt.site/
```

The shell blocks cleartext HTTP, disables file/content access, accepts first-party cookies, keeps only the approved UCHIHA RADIUS hosts inside the WebView, and sends external links to Android.

This is the APK packaging layer. Provider-ready MikroTik provisioning, activation verification, accounting/quota enforcement, and other live operations remain backend-gated and must use the v37 production connector rather than browser-only mock data.
