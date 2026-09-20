module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  modulePathIgnorePatterns: [
    '<rootDir>/build/',
  ],
  moduleNameMapper: {
    '^@expo/vector-icons/Ionicons$': '<rootDir>/tests/mocks/ionicons.ts',
  },
  // Widened 2026-09-20. This previously counted services and components only, so
  // App.tsx (20,924 lines), screens, hooks and providers — the entire native
  // shell — sat outside the denominator. The reported percentage flattered the
  // suite by excluding the least-tested code in the repository.
  collectCoverageFrom: [
    'services/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    'App.tsx',
    'screens/**/*.{ts,tsx}',
    'hooks/**/*.{ts,tsx}',
    'providers/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
};
