// Babel config exists FOR JEST, not for Metro.
//
// Metro does not need this file — `expo/metro-config` applies
// `babel-preset-expo` on its own, which is why the project ran for this long
// without one. `babel-jest` has no such default: without a config it parses
// React Native's own sources as plain JavaScript, and the first Flow annotation
// inside `@react-native/jest-preset/jest/setup.js` (`value(id: TimeoutID)`)
// fails the whole suite before a single test runs.
//
// Keep it minimal and keep it identical to what Metro would apply. A preset
// that diverges here means tests exercise a differently-compiled app than the
// one that ships.
module.exports = function babelConfig(api) {
  api.cache(true);

  return {
    presets: ["babel-preset-expo"],
  };
};
