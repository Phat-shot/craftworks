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
// .github/workflows/apk.yml. Unambiguously identifies the source commit.
export const COMMIT_SHA: string =
  (Constants.expoConfig?.extra?.commitSha as string | undefined) || 'dev';

// CI's GITHUB_RUN_NUMBER — replaces the old hand-bumped app.json "version"
// (see app.config.js's android.versionCode comment for why: that scheme
// drifted out of sync repeatedly since it relied on remembering to bump it
// before every push). Shown in the app's Settings screen instead of a
// version number.
export const BUILD_NUMBER: string =
  (Constants.expoConfig?.extra?.buildNumber as string | undefined) || 'dev';
