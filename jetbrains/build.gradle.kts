import java.util.Base64

plugins {
    java
    id("org.jetbrains.kotlin.jvm") version "2.1.21"
    id("org.jetbrains.intellij.platform") version "2.6.0"
}
group = "app.gotempest"
version = "3.17.4"
repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}
dependencies {
    intellijPlatform { gateway("2024.3.6") }
}
kotlin { compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21 } }
java { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
tasks.processResources {
    from("../LICENSE") { into("META-INF") }
    from("../scripts") { into("helper/scripts"); include("remote.js", "clients.js") }
    from("../lib") { into("helper/lib") }
    // Use the same artwork as VS Code; Gateway requires an SVG logo resource.
    val icon = file("../vscode/media/icon.png")
    inputs.file(icon)
    doLast {
        val data = Base64.getEncoder().encodeToString(icon.readBytes())
        destinationDir.resolve("META-INF/pluginIcon.svg").writeText(
            """<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40" viewBox="0 0 40 40"><image width="40" height="40" xlink:href="data:image/png;base64,$data"/></svg>"""
        )
    }
}
intellijPlatform {
    buildSearchableOptions = false
    instrumentCode = false
    pluginConfiguration { ideaVersion { sinceBuild = "243" } }
}
