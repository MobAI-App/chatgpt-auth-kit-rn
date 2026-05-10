/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^react-native-tcp-socket$': '<rootDir>/__mocks__/empty.ts',
    '^react-native-inappbrowser-reborn$': '<rootDir>/__mocks__/empty.ts',
    '^react-native-keychain$': '<rootDir>/__mocks__/empty.ts',
  },
};
