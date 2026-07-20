import Constants from 'expo-constants';

// Server endpoint — baked in at prebuild time via app.config.js, which reads
// the SERVER_URL env var and puts it in the native app manifest's `extra`
// field (see app.config.js for why this route was chosen over the more
// common EXPO_PUBLIC_* babel-inlining approach — that turned out unreliable
// for the exact command the Gradle release build runs). Set per branch in
// .github/workflows/apk.yml (main → https://arops.srz.one, test → the
// default below). For local device testing against your own machine, export
// SERVER_URL yourself before prebuilding.
export const SERVER_URL: string =
  (Constants.expoConfig?.extra?.serverUrl as string | undefined) || 'https://dev.srz.one';

// When this build was produced — same build-time-bake mechanism as
// SERVER_URL above (see app.config.js), set per build in
// .github/workflows/apk.yml. Shown in the Settings screen so testers can
// tell which build they're actually running.
export const BUILD_TIME: string =
  (Constants.expoConfig?.extra?.buildTime as string | undefined) || '–';

// Short commit SHA — same build-time-bake mechanism, set per build in
// .github/workflows/apk.yml. The version in app.json is bumped by hand and
// can drift out of sync with what's actually running; this is the one
// value that always unambiguously identifies the source commit.
export const COMMIT_SHA: string =
  (Constants.expoConfig?.extra?.commitSha as string | undefined) || 'dev';
