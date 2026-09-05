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
        versionCode = 9
        versionName = "2.0.0-alpha08"
        buildConfigField("String", "API_BASE_URL", "\"https://panel.uchiha-builder.com/api/mobile\"")
    }

    buildFeatures {
        buildConfig = true
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
