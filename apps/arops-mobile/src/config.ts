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
