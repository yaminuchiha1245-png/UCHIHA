plugins { id("com.android.application") }
android {
    namespace = "com.gamezone.admin"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gamezone.admin"
        minSdk = 26
        targetSdk = 35
        versionCode = 25
        versionName = "2.1.4"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}
