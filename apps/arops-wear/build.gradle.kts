// Deliberately conservative, well-established versions rather than the
// absolute latest — this project has no local Java/Gradle/Android SDK to
// test-compile against, only the GitHub Actions workflow can actually build
// it, so minimizing exposure to anything less battle-tested matters more
// than being current. Safe to bump once verified in a real build.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
