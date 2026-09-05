plugins { id("com.android.application") }
android {
    namespace = "com.gamezone.admin"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gamezone.admin"
        minSdk = 26
        targetSdk = 35
        versionCode = 23
        versionName = "2.1.2"
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
}
