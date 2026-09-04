# UCHIHA Control Center Android APK

This Android application is a secure installable shell for the production Control Center at `https://panel.uchiha-builder.com/`.

Security behavior:
- HTTPS-only; cleartext traffic is disabled.
- The Control Center domain stays inside the app.
- External domains open in the device browser.
- SSL certificate errors are rejected.
- JavaScript and DOM storage are enabled because the Control Center requires them.
- File/content access from the WebView is disabled.
- Login cookies persist in the app WebView.

Package: `com.uchiha.controlcenter`

The GitHub Actions workflow `.github/workflows/uchiha-control-center-apk.yml` builds an installable debug APK and publishes it as the `UCHIHA-Control-Center-APK` artifact.
