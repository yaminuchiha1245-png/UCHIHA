plugins {
    id("com.android.application")
}

val radiusUrl = providers.gradleProperty("uchihaRadiusUrl")
    .orElse("https://uchiha-radius-demo.yaminuchiha1245.chatgpt.site/")

android {
    namespace = "com.uchiha.radius"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.uchiha.radius"
        minSdk = 24
        targetSdk = 35
        versionCode = 10100
        versionName = "1.0.0-preview-v101"
        buildConfigField("String", "RADIUS_URL", "\"${radiusUrl.get()}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
