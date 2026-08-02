module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  modulePathIgnorePatterns: [
    '<rootDir>/build/',
  ],
  moduleNameMapper: {
    '^@expo/vector-icons/Ionicons$': '<rootDir>/tests/mocks/ionicons.ts',
  },
  collectCoverageFrom: [
    'services/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
};
