import java.util.Properties

plugins {
    id("com.android.application")
}

// A chave de assinatura fica FORA do repositório (padrão: C:\Python - local\chaves-android).
// O SHA-256 dela está em brunoignr-code.github.io/.well-known/assetlinks.json:
// trocar a chave quebra a verificação e obriga a reinstalar o app.
val chavesArquivo = file(
    System.getenv("AFAZERES_CHAVES") ?: "${rootDir}/../../chaves-android/afazeres.properties"
)
val chaves = Properties().apply { if (chavesArquivo.exists()) chavesArquivo.inputStream().use { load(it) } }

android {
    namespace = "br.afazeres.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.afazeres.app"
        minSdk = 29
        targetSdk = 36
        versionCode = 5
        versionName = "1.4"
        // v30: servidor dos alarmes nativos (pareamento, agenda e botões da notificação).
        buildConfigField("String", "ALARM_SERVER", "\"https://tarefas-sync.brunoignr-code.workers.dev\"")
    }

    buildFeatures { buildConfig = true }

    signingConfigs {
        create("release") {
            if (chavesArquivo.exists()) {
                storeFile = File(chavesArquivo.parentFile, chaves.getProperty("storeFile"))
                storePassword = chaves.getProperty("storePassword")
                keyAlias = chaves.getProperty("keyAlias")
                keyPassword = chaves.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            // O debug também usa a chave oficial, para a verificação do domínio funcionar.
            if (chavesArquivo.exists()) signingConfig = signingConfigs.getByName("release")
            // No emulador, os alarmes conversam com um servidor falso no PC (10.0.2.2 = o PC), nunca com a conta real.
            buildConfigField("String", "ALARM_SERVER", "\"http://10.0.2.2:8790\"")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.6.2")
}
