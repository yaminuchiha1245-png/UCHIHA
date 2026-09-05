plugins {
    id("com.android.application")
}

android {
    namespace = "com.uchiha.controlcenter"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.uchiha.controlcenter"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "2.0.0-alpha01"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
