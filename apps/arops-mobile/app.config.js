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
    },
    extra: {
      ...config.extra,
      serverUrl: process.env.SERVER_URL || 'https://dev.srz.one',
      // Set per build in .github/workflows/apk.yml — shown in the app's
      // Settings screen (App.tsx) so testers can tell which build they're
      // actually running. Falls back to "now" for local dev builds.
      buildTime: process.env.BUILD_TIME || new Date().toISOString(),
    },
  };
};
