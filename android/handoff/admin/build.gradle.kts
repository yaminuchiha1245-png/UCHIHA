plugins { id("com.android.application") }
android {
    namespace = "com.gamezone.admin"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gamezone.admin"
        minSdk = 26
        targetSdk = 35
        versionCode = 21
        versionName = "2.1.0"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}
