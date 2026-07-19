module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets-core's plugin compiles the `useFrameProcessor`
    // callback (IR-beacon scanning, see src/hooks/useIrScan.ts) into a
    // worklet that runs on VisionCamera's own frame-processor thread.
    plugins: ['react-native-worklets-core/plugin'],
  };
};
