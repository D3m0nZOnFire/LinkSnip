const Database = require('better-sqlite3');
const { migrateSlugCase } = require('../../../config/migrations');

// Slugs ignore case: /s/Promo and /s/promo are one short link. migrateSlugCase adds a unique NOCASE index per
// content table. An instance that already has slugs differing only in case gets a warning naming them and keeps
// running without that index (the slug service still refuses new look-alikes).

const TABLES = ['urls', 'bundles', 'pastes', 'files'];

function makeDb(rows = {}) {
  const db = new Database(':memory:');
  for (const table of TABLES) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL)`);
    for (const slug of rows[table] || []) db.prepare(`INSERT INTO ${table} (slug) VALUES (?)`).run(slug);
  }
  return db;
}

const nocaseIndex = (db, table) => db.prepare(
  "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql LIKE '%NOCASE%'"
).get(table);

const quiet = () => ({ log: jest.fn(), warn: jest.fn() });

describe('migrateSlugCase', () => {
  it('adds a unique case-insensitive slug index to every content table', () => {
    const db = makeDb({ urls: ['Promo'], bundles: ['Promo'] });
    migrateSlugCase(db, quiet());
    for (const table of TABLES) {
      expect(nocaseIndex(db, table)).toBeDefined();
      db.prepare(`INSERT INTO ${table} (slug) VALUES ('Thing')`).run();
      expect(() => db.prepare(`INSERT INTO ${table} (slug) VALUES ('thing')`).run()).toThrow(/UNIQUE/);
    }
  });

  it('is idempotent', () => {
    const db = makeDb();
    migrateSlugCase(db, quiet());
    expect(() => migrateSlugCase(db, quiet())).not.toThrow();
  });

  it('warns about slugs that differ only in case and skips that table, without failing', () => {
    const db = makeDb({ pastes: ['Promo', 'promo', 'other'] });
    const logger = quiet();
    expect(() => migrateSlugCase(db, logger)).not.toThrow();
    expect(nocaseIndex(db, 'pastes')).toBeUndefined();
    expect(nocaseIndex(db, 'urls')).toBeDefined();
    const message = logger.warn.mock.calls.map(c => c.join(' ')).join('\n');
    expect(message).toMatch(/pastes/);
    expect(message).toMatch(/Promo/);
    expect(message).toMatch(/promo/);
  });

  it('adds the index once the look-alikes are gone', () => {
    const db = makeDb({ files: ['Promo', 'promo'] });
    migrateSlugCase(db, quiet());
    db.prepare("UPDATE files SET slug = 'promo2' WHERE slug = 'promo'").run();
    migrateSlugCase(db, quiet());
    expect(nocaseIndex(db, 'files')).toBeDefined();
  });
});
