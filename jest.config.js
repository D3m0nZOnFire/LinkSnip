module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'models/**/*.js',
    'services/**/*.js',
    'middleware/**/*.js'
  ],
  coverageDirectory: 'coverage',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js'],
  testTimeout: 10000,
  maxWorkers: 1, // SQLite concurrency
  clearMocks: true,
  // Ignore the actual database.js to avoid conflicts with test database
  modulePathIgnorePatterns: ['<rootDir>/node_modules/']
};
