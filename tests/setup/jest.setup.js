const fs = require('fs');
const os = require('os');
const path = require('path');

// Each test file gets its own DATA_DIR, so settings.json / roles.json written by
// ConfigService never land in the project root. Set before anything requires config/paths.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-test-'));
process.env.DATA_DIR = testDataDir;
// IP hashes are keyed with IP_HASH_SECRET (config/env.js requireIpHashSecret)
process.env.IP_HASH_SECRET = 'test-ip-hash-secret-'.padEnd(64, 'x');

const {
  createTestDatabase,
  clearTestDatabase,
  closeTestDatabase
} = require('./testDatabase');

// Create the test database FIRST (before any mocking)
// This ensures the database exists when modules try to use it
const testDb = createTestDatabase();

// Mock the database module - return the already-created test database
jest.mock('../../config/database', () => {
  const { getTestDatabase } = require('./testDatabase');
  return getTestDatabase();
});

// Cleanup before each test - clears all data but preserves schema
beforeEach(() => {
  clearTestDatabase();
});

// Global teardown - runs once after all tests
afterAll(() => {
  closeTestDatabase();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

// Set a reasonable timeout for all tests
jest.setTimeout(10000);
