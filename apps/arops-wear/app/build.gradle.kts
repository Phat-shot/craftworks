plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "one.srz.aropswear"
    compileSdk = 34

    defaultConfig {
        applicationId = "one.srz.aropswear"
        // Wear OS 3+ only (API 30) — matches the Pixel Watch line; Google
        // itself no longer supports anything older.
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        // Versionsschema (siehe CLAUDE.md): jedes Release (main) +1, jeder
        // Bugfix auf test +0.1 — von Hand hochzählen, gemeinsam mit
        // apps/arops-mobile/app.json "version" (dieselbe Zählung, beide
        // Apps gehören zum selben AR-Ops-Release).
        versionName = "1"
    }

    buildFeatures {
        compose = true
        // AGP 8+ no longer generates BuildConfig by default — needed here so
        // versionName (single source of truth, see defaultConfig above) can
        // be shown small on the pairing screen instead of a second hardcoded copy.
        buildConfig = true
    }
    composeOptions {
        // Paired with Kotlin 1.9.24 per the official Compose-Kotlin
        // compatibility map.
        kotlinCompilerExtensionVersion = "1.5.14"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    packaging {
        resources.excludes.add("/META-INF/{AL2.0,LGPL2.1}")
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.06.00"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Wear-specific Compose (Material 2.5 line — stable; Material 3 for Wear
    // is still alpha as of this writing).
    implementation("androidx.wear.compose:compose-material:1.3.1")
    implementation("androidx.wear.compose:compose-foundation:1.3.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    // Data Layer API — receives game-state pushes from the paired phone.
    implementation("com.google.android.gms:play-services-wearable:18.1.0")
    // OSM tile fallback fetch (no MapLibre-equivalent renderer on Wear OS).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // QR code generation for the pairing handshake (encode-only — no camera/
    // scanning on the watch, that happens on the phone).
    implementation("com.google.zxing:core:3.5.3")
}
