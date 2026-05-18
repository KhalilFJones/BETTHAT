module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      // nativewind/babel is a PRESET (returns { plugins: [...] }), not a plugin.
      // It already includes react-native-worklets/plugin internally, so the
      // reanimated/worklets plugin doesn't need a separate entry here.
      'nativewind/babel',
    ],
  };
};
