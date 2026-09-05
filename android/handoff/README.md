# Game Zone Android Handoff

Two Android wrappers are maintained here:
- `client`: customer app, package `com.gamezone.store`, opens the live Game Zone storefront and supports the browser file picker used for top-up receipts.
- `admin`: owner app, package `com.gamezone.admin`, opens the live protected Admin center.

Both wrappers allow only the configured live Game Zone HTTPS host inside WebView. External HTTP/HTTPS links are opened outside the app. SSL errors are never bypassed. Cleartext traffic is disabled.

The downloadable handoff APKs are built as Android debug-signed install packages for direct installation/handoff. For Play Store or long-term production updates, the owner must sign a release build with owner-controlled Android signing material so future updates retain the same signing identity.
