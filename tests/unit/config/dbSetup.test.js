const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { configureDatabase } = require('../../../config/dbSetup');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linksnip-db-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('configureDatabase', () => {
  it('turns on WAL, a busy timeout and foreign keys', () => {
    const db = new Database(path.join(dir, 'test.db'));

    configureDatabase(db);

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
});
