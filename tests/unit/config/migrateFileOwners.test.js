const Database = require('better-sqlite3');
const { migrateFileOwners } = require('../../../config/migrations');

const quiet = { log: () => {} };

// Files used to belong to their uploader for good (userId NOT NULL, ON DELETE CASCADE): deleting an account also
// deleted its files in teams. migrateFileOwners makes userId nullable with ON DELETE SET NULL, like the other
// content tables, so team files stay with the team.

function oldDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE analytics_events (id INTEGER PRIMARY KEY AUTOINCREMENT, targetType TEXT, targetId INTEGER);
    CREATE TABLE files (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      userId       INTEGER  NOT NULL,
      slug         TEXT     UNIQUE NOT NULL,
      storedName   TEXT     NOT NULL,
      createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP, isQuarantined INTEGER DEFAULT 0, teamId INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_files_slug ON files(slug);
    CREATE TRIGGER trg_analytics_delete_files AFTER DELETE ON files
    BEGIN
      DELETE FROM analytics_events WHERE targetType = 'file' AND targetId = OLD.id;
    END;
    INSERT INTO users (username) VALUES ('alice'), ('bob');
    INSERT INTO teams (name) VALUES ('Acme');
    INSERT INTO files (userId, slug, storedName) VALUES (1, 'a', 'a.bin'), (1, 'gone', 'g.bin'), (2, 'b', 'b.bin');
    UPDATE files SET teamId = 1 WHERE slug = 'a';
    DELETE FROM files WHERE slug = 'gone';
    INSERT INTO analytics_events (targetType, targetId) VALUES ('file', 1), ('file', 3);
  `);
  return db;
}

const userIdColumn = (db) => db.prepare('PRAGMA table_info(files)').all().find(c => c.name === 'userId');
const userFk = (db) => db.prepare('PRAGMA foreign_key_list(files)').all().find(f => f.from === 'userId');

describe('migrateFileOwners', () => {
  let db;
  beforeEach(() => {
    db = oldDb();
    migrateFileOwners(db, quiet);
  });

  it('makes userId nullable, set to NULL when the user is deleted', () => {
    expect(userIdColumn(db).notnull).toBe(0);
    expect(userFk(db).on_delete).toBe('SET NULL');
  });

  it('keeps every row, column and team', () => {
    expect(db.prepare('SELECT id, userId, slug, storedName, teamId, isQuarantined FROM files ORDER BY id').all()).toEqual([
      { id: 1, userId: 1, slug: 'a', storedName: 'a.bin', teamId: 1, isQuarantined: 0 },
      { id: 3, userId: 2, slug: 'b', storedName: 'b.bin', teamId: null, isQuarantined: 0 }
    ]);
  });

  it('keeps the indexes, the triggers and the ID sequence (deleted IDs stay unused)', () => {
    const names = db.prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'files' AND type IN ('index', 'trigger')").all().map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['idx_files_slug', 'trg_analytics_delete_files']));
    db.prepare('DELETE FROM files WHERE id = 3').run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE targetId = 3").get().n).toBe(0);
    const { lastInsertRowid } = db.prepare("INSERT INTO files (userId, slug, storedName) VALUES (2, 'c', 'c.bin')").run();
    expect(Number(lastInsertRowid)).toBe(4);
  });

  it('deleting a user now keeps their files, without an owner', () => {
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(db.prepare("SELECT userId, teamId FROM files WHERE slug = 'a'").get()).toEqual({ userId: null, teamId: 1 });
  });

  it('runs once (a second run changes nothing) and leaves foreign keys on', () => {
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'files'").get().sql;
    migrateFileOwners(db, quiet);
    expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'files'").get().sql).toBe(before);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('skips a database without a files table', () => {
    const empty = new Database(':memory:');
    expect(() => migrateFileOwners(empty, quiet)).not.toThrow();
  });
});
