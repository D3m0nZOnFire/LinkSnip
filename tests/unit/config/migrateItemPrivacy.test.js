const Database = require('better-sqlite3');
const { migrateItemPrivacy } = require('../../../config/migrations');

// Private items: one isPrivate column on every content table. Files had their own way (sharingMode 'restricted'
// + an allowedUsers list); restricted files become private and the two old columns go.

function oldDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE pastes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT,
      sharingMode TEXT DEFAULT 'public', allowedUsers TEXT DEFAULT '[]'
    );
    CREATE INDEX idx_files_slug ON files(slug);
    INSERT INTO urls (slug) VALUES ('u');
    INSERT INTO files (slug, sharingMode, allowedUsers) VALUES
      ('open', 'public', '[]'), ('mine', 'restricted', '[]'), ('shared', 'restricted', '[4, 5]');
  `);
  return db;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

describe('migrateItemPrivacy', () => {
  let db;
  let logger;
  beforeEach(() => {
    db = oldDb();
    logger = { log: jest.fn(), warn: jest.fn() };
    migrateItemPrivacy(db, logger);
  });

  it.each(['urls', 'bundles', 'pastes', 'files'])('adds isPrivate (default 0) to %s', (table) => {
    const column = db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === 'isPrivate');
    expect(column).toEqual(expect.objectContaining({ notnull: 1, dflt_value: '0' }));
  });

  it('keeps existing items public', () => {
    expect(db.prepare('SELECT isPrivate FROM urls').get().isPrivate).toBe(0);
  });

  it('makes restricted files private and drops the old columns', () => {
    expect(db.prepare('SELECT slug, isPrivate FROM files ORDER BY id').all()).toEqual([
      { slug: 'open', isPrivate: 0 }, { slug: 'mine', isPrivate: 1 }, { slug: 'shared', isPrivate: 1 }
    ]);
    expect(columns(db, 'files')).not.toEqual(expect.arrayContaining(['sharingMode']));
    expect(columns(db, 'files')).not.toEqual(expect.arrayContaining(['allowedUsers']));
  });

  it('warns about files that were shared with other people (they lose access)', () => {
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('1 file'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('shared'));
  });

  it('can run again', () => {
    expect(() => migrateItemPrivacy(db, logger)).not.toThrow();
    expect(db.prepare("SELECT isPrivate FROM files WHERE slug = 'mine'").get().isPrivate).toBe(1);
  });

  it('keeps the indexes of files', () => {
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_files_slug'").get()).toBeTruthy();
  });
});
