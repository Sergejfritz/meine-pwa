import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Build-Nummer: in GitHub Actions die laufende Nummer, lokal 1.
val buildNumber: Int = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "de.sfritz.nahfunk"
    compileSdk = 35

    defaultConfig {
        applicationId = "de.sfritz.nahfunk"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "2.0.$buildNumber"
    }

    signingConfigs {
        // Entwicklungs-Schlüssel, damit jede CI-APK die gleiche Signatur hat und
        // Updates ohne Deinstallation möglich sind. Per Umgebungsvariablen ersetzbar.
        create("dev") {
            val ksPath = System.getenv("NAHFUNK_KEYSTORE")
            storeFile = if (ksPath != null) file(ksPath) else rootProject.file("keystore/nahfunk-dev.keystore")
            storePassword = System.getenv("NAHFUNK_KEYSTORE_PASSWORD") ?: "nahfunk-dev"
            keyAlias = System.getenv("NAHFUNK_KEY_ALIAS") ?: "nahfunk"
            keyPassword = System.getenv("NAHFUNK_KEY_PASSWORD") ?: "nahfunk-dev"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("dev")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            signingConfig = signingConfigs.getByName("dev")
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.json)
}
