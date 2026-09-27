# Workstream 05 → coordinator 00 | 2026-09-27

**Actual VPS baseline tested:** UCHIHA Bot Service V0.5.51. No Android source, credentials, production DB or public APK was changed.

## Verified current-code tests
- An isolated private copy of `android/native-shell` ran **43 Python/JVM tests: all passed** on the VPS, Actions run `36284215820`. No Android SDK/device from the local ChatGPT container was used as production evidence.
- Live public PWA preflight for both stores: PASS, Actions run `36284273132`. This confirms public PWA metadata, **not physical Android installation**.
- Technical inspection of the existing private APKs: PASS, Actions run `36284348791`. It checks actual Android package ID, version, min/target SDK, INTERNET-only permissions, tenant-specific embedded start URL, one 512×512 launcher PNG, alignment, intact archive, exact current merchant display name/icon, and independently verifies APK v2 signature validity. It does **not** approve the release-signing certificate.

## Private APK inventory (DO NOT PUBLISH)
- Demo bot 1: `com.uchiha.store.demo`, version `1.0.0`, SHA256 `1eada4ba58bd452e20f8de152a2d649fcaa499f9c9addd5e74357b86dbcaffc7`; startup URL remains tenant 1.
- Game Zone bot 2: `com.uchiha.gamezone`, version `1.0.0`, SHA256 `659531ef7f179048d42e30d2f5ef4fe6ede948aedb424de33182875c037a9af4`; startup URL remains tenant 2.
- Both technical v2 signature checks passed; **the signer has NOT been matched to an owner-approved persistent release certificate**.
- Existing private staging directory on the VPS: `/opt/uchiha/projects/bot-service-stage/workstream-05-signed-private-20260926/`.

## Release blockers
1. Workstream 05's V7 handoff package is not proven merged with the live Android source. Compare the actual latest source before applying anything; never overwrite newer code.
2. Obtain owner authorization for a persistent APK signer, record the public SHA256 certificate fingerprint privately, and verify *the exact release APK* against it.
3. Perform physical-device acceptance for Android 7 and 13+ where devices are available, including side-by-side installations, tenant isolation, navigation/back behavior, keyboard/insets, offline recovery, and clean updates with the *same* signer. Record actual device results; untested models must be marked NOT TESTED.
4. After completion, 00 rechecks live PWA URLs and active site version, takes a fresh backup, then permits verified immutable customer APK publication. Do not use the current private signing candidates as a public release.

This handoff does not enable supplier charging or publish any APK. The WS02 first-paint candidate remains separate and not deployed.
