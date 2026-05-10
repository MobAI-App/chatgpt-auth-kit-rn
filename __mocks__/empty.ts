// Stub used by jest moduleNameMapper to satisfy native-module imports
// (`react-native-tcp-socket`, `react-native-keychain`,
// `react-native-inappbrowser-reborn`) under a Node test environment. Tests
// only exercise pure functions; methods on these stubs are never called.
const empty: any = new Proxy(
  {},
  {
    get: () => empty,
  },
);
export default empty;
export const ACCESSIBLE = empty;
