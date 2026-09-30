const Database = require('better-sqlite3');
const { migrateTags } = require('../../../config/migrations');

const quiet = { log: () => {} };

// An old-schema database: tags with a table-wide UNIQUE name, and one junction
// table per type (url_tags with createdAt, paste_tags and file_tags without).
function oldSchemaDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE pastes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#34d399',
      userId INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE url_tags (
      urlId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (urlId, tagId),
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    );
    CREATE TABLE file_tags (
      fileId INTEGER NOT NULL,
      tagId  INTEGER NOT NULL,
      PRIMARY KEY (fileId, tagId),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId)  REFERENCES tags(id)  ON DELETE CASCADE
    );
    CREATE TABLE paste_tags (
      pasteId INTEGER NOT NULL,
      tagId   INTEGER NOT NULL,
      PRIMARY KEY (pasteId, tagId),
      FOREIGN KEY (pasteId) REFERENCES pastes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId)   REFERENCES tags(id)   ON DELETE CASCADE
    );
    CREATE INDEX idx_tags_userId ON tags(userId);
    CREATE INDEX idx_tags_name ON tags(name);
    CREATE INDEX idx_url_tags_urlId ON url_tags(urlId);
    INSERT INTO users (username) VALUES ('alice'), ('bob');
    INSERT INTO urls (slug) VALUES ('u1'), ('u2');
    INSERT INTO bundles (slug) VALUES ('b1');
    INSERT INTO pastes (slug) VALUES ('p1');
    INSERT INTO files (slug) VALUES ('f1');
  `);
  return db;
}

function seed(db) {
  db.exec(`
    INSERT INTO tags (id, name, color, userId, createdAt) VALUES
      (3, 'work', '#60a5fa', 1, '2026-01-01 09:00:00'),
      (7, 'fun', '#f472b6', 1, '2026-01-02 09:00:00'),
      (8, 'docs', '#fbbf24', 2, '2026-01-03 09:00:00');
    INSERT INTO url_tags (urlId, tagId, createdAt) VALUES (1, 3, '2026-02-01 10:00:00'), (1, 7, '2026-02-02 10:00:00'),
                                                          (2, 7, '2026-02-03 10:00:00');
    INSERT INTO paste_tags (pasteId, tagId) VALUES (1, 3);
    INSERT INTO file_tags (fileId, tagId) VALUES (1, 8), (1, 3);
  `);
}

const tableExists = (db, name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
const tagIdsOf = (db, type, id) => db.prepare(
  'SELECT tagId FROM taggables WHERE targetType = ? AND targetId = ? ORDER BY tagId'
).all(type, id).map(r => r.tagId);
const allTaggables = (db) => db.prepare(
  'SELECT tagId, targetType, targetId, createdAt FROM taggables ORDER BY targetType, targetId, tagId'
).all();

describe('migrateTags', () => {
  it('moves every link, paste and file tag into taggables: each item keeps exactly its tags', () => {
    const db = oldSchemaDb();
    seed(db);

    migrateTags(db, quiet);

    expect(tagIdsOf(db, 'url', 1)).toEqual([3, 7]);
    expect(tagIdsOf(db, 'url', 2)).toEqual([7]);
    expect(tagIdsOf(db, 'paste', 1)).toEqual([3]);
    expect(tagIdsOf(db, 'file', 1)).toEqual([3, 8]);
    expect(tagIdsOf(db, 'bundle', 1)).toEqual([]);
    expect(allTaggables(db)).toHaveLength(6);
  });

  it('keeps when a link was tagged', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    const row = allTaggables(db).find(r => r.targetType === 'url' && r.targetId === 2);
    expect(row.createdAt).toBe('2026-02-03 10:00:00');
  });

  it('drops the old junction tables', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    for (const table of ['url_tags', 'paste_tags', 'file_tags']) expect(tableExists(db, table)).toBe(false);
  });

  it('keeps every tag with its ID, name, color, owner and creation date', () => {
    const db = oldSchemaDb();
    seed(db);
    const before = db.prepare('SELECT * FROM tags ORDER BY id').all();

    migrateTags(db, quiet);

    expect(db.prepare('SELECT * FROM tags ORDER BY id').all()).toEqual(before);
  });

  it('lets two users have a tag with the same name, but not one user twice', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    expect(() => db.prepare("INSERT INTO tags (name, userId) VALUES ('work', 2)").run()).not.toThrow();
    expect(() => db.prepare("INSERT INTO tags (name, userId) VALUES ('work', 1)").run()).toThrow(/UNIQUE/);
  });

  it('continues the tag IDs after the highest old one', () => {
    const db = oldSchemaDb();
    seed(db);
    db.exec('DELETE FROM tags WHERE id = 8');
    migrateTags(db, quiet);

    const { lastInsertRowid } = db.prepare("INSERT INTO tags (name, userId) VALUES ('new', 1)").run();
    expect(Number(lastInsertRowid)).toBe(9);
  });

  it('keeps deleted tag IDs unused when every tag was deleted', () => {
    const db = oldSchemaDb();
    seed(db);
    db.exec('DELETE FROM tags');
    migrateTags(db, quiet);

    const { lastInsertRowid } = db.prepare("INSERT INTO tags (name, userId) VALUES ('new', 1)").run();
    expect(Number(lastInsertRowid)).toBe(9);
  });

  it('can run again without changing anything', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);
    const tags = db.prepare('SELECT * FROM tags ORDER BY id').all();
    const rows = allTaggables(db);

    migrateTags(db, quiet);

    expect(db.prepare('SELECT * FROM tags ORDER BY id').all()).toEqual(tags);
    expect(allTaggables(db)).toEqual(rows);
  });

  it('creates tags and taggables on a new database', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
      CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
      INSERT INTO users (username) VALUES ('alice');
      INSERT INTO urls (slug) VALUES ('u1');
    `);

    migrateTags(db, quiet);

    const { lastInsertRowid } = db.prepare("INSERT INTO tags (name, userId) VALUES ('work', 1)").run();
    db.prepare("INSERT INTO taggables (tagId, targetType, targetId) VALUES (?, 'url', 1)").run(lastInsertRowid);
    expect(tagIdsOf(db, 'url', 1)).toEqual([Number(lastInsertRowid)]);
  });

  it('refuses the same tag twice on one item', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    expect(() => db.prepare("INSERT INTO taggables (tagId, targetType, targetId) VALUES (3, 'url', 1)").run())
      .toThrow(/UNIQUE|PRIMARY KEY/);
  });

  it.each([
    ['url', 'urls'], ['bundle', 'bundles'], ['paste', 'pastes'], ['file', 'files']
  ])('removes the tags of a deleted %s, and only its own', (type, table) => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);
    db.prepare("INSERT INTO taggables (tagId, targetType, targetId) VALUES (7, 'bundle', 1)").run();
    const others = allTaggables(db).filter(r => !(r.targetType === type && r.targetId === 1));

    db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();

    expect(tagIdsOf(db, type, 1)).toEqual([]);
    expect(allTaggables(db)).toEqual(others);
  });

  it('removes a deleted tag from every item', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    db.prepare('DELETE FROM tags WHERE id = 3').run();

    expect(allTaggables(db).map(r => r.tagId)).not.toContain(3);
    expect(tagIdsOf(db, 'file', 1)).toEqual([8]);
  });

  it("still deletes a user's tags with the user", () => {
    const db = oldSchemaDb();
    seed(db);
    migrateTags(db, quiet);

    db.prepare('DELETE FROM users WHERE id = 1').run();

    expect(db.prepare('SELECT id FROM tags').all().map(r => r.id)).toEqual([8]);
    expect(allTaggables(db)).toEqual([expect.objectContaining({ tagId: 8, targetType: 'file', targetId: 1 })]);
  });
});
