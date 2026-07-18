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
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    serverUrl: process.env.SERVER_URL || 'https://dev.srz.one',
  },
});
