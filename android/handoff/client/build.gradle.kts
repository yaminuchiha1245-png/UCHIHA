plugins { id("com.android.application") }
android {
    namespace = "com.gamezone.store"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gamezone.store"
        minSdk = 26
        targetSdk = 35
        versionCode = 34
        versionName = "3.1.3"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}
