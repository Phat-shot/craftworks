// Dynamic layer on top of app.json — resolves the backend endpoint from the
// SERVER_URL env var at prebuild time and bakes it into the native app
// manifest (read at runtime via expo-constants, see src/config.ts).
//
// This exists because the more common EXPO_PUBLIC_* babel-inlining approach
// (see babel-preset-expo/inline-env-vars.js) turned out NOT to reliably pick
// up env vars during `expo export:embed --dev false` — exactly the command
// the Gradle release build runs (see android/app/build.gradle
// bundleCommand) — reproduced locally, not just a CI quirk. expo-constants
// reads app.config.js in the main CLI process at prebuild time instead of
// inside a Metro transform worker, which is what actually works reliably.
//
// APP_CHANNEL ('main' | 'test', set per branch in .github/workflows/apk.yml,
// same pattern as SERVER_URL) additionally swaps name/package/icon so the
// test build can be installed ALONGSIDE the main build on the same device
// instead of overwriting it — same applicationId would just replace
// whichever one was installed first. 'test' is the default here (matching
// SERVER_URL's own default), so a local `npx expo prebuild` without any env
// vars set produces the same "Beta" build a tester would sideload.
module.exports = ({ config }) => {
  const isMain = process.env.APP_CHANNEL === 'main';
  return {
    ...config,
    name: isMain ? config.name : `${config.name} Beta`,
    icon: isMain ? config.icon : './assets/icons/icon-beta.png',
    android: {
      ...config.android,
      package: isMain ? config.android.package : `${config.android.package}.beta`,
      adaptiveIcon: {
        ...config.android.adaptiveIcon,
        foregroundImage: isMain
          ? config.android.adaptiveIcon.foregroundImage
          : './assets/icons/adaptive-foreground-beta.png',
      },
      // Versionsschema (see CLAUDE.md): no more hand-bumped app.json
      // "version" — it drifted out of sync repeatedly. BUILD_NUMBER (set in
      // .github/workflows/apk.yml from GITHUB_RUN_NUMBER, GitHub's own
      // guaranteed-monotonic per-workflow counter) drives versionCode
      // instead, matching the Wear app's build.gradle.kts. First time this
      // has ever been a real strictly-increasing value — Android needs
      // that for a sideload install to upgrade in place instead of always
      // requiring an uninstall first (versionCode was static 1 before).
      versionCode: parseInt(process.env.BUILD_NUMBER || '1', 10),
    },
    extra: {
      ...config.extra,
      serverUrl: process.env.SERVER_URL || 'https://dev.srz.one',
      // Set per build in .github/workflows/apk.yml — shown in the app's
      // Settings screen (App.tsx) so testers can tell which build they're
      // actually running. Falls back to "now" for local dev builds.
      buildTime: process.env.BUILD_TIME || new Date().toISOString(),
      // Short commit SHA — unambiguously identifies the exact source a
      // build came from, independent of the (now purely nominal) app.json
      // "version" field.
      commitSha: process.env.COMMIT_SHA || 'dev',
      // Replaces app.json "version" as the in-app-displayed identifier —
      // see the versionCode comment above for why.
      buildNumber: process.env.BUILD_NUMBER || 'dev',
    },
  };
};
