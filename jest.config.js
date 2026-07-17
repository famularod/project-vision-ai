module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  modulePathIgnorePatterns: [
    '<rootDir>/project_photo_update_refactor_phase1/',
    '<rootDir>/lib/project_photo_update_refactor_phase1/',
    '<rootDir>/build/',
  ],
  collectCoverageFrom: [
    'services/**/*.{ts,tsx}',
    'components/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  clearMocks: true,
};
