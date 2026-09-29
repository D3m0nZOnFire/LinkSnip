const Database = require('better-sqlite3');
const { migrateUserRoles } = require('../../../config/migrations');

// Seeds an old-schema users table (tier column, no role column) in its own in-memory DB.
function oldSchemaDb(users) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      isAdmin INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'free'
    )
  `);
  const insert = db.prepare('INSERT INTO users (username, password, tier) VALUES (?, ?, ?)');
  for (const [username, tier] of users) insert.run(username, 'x', tier);
  return db;
}

const quiet = { log: () => {} };

function roleOf(db, username) {
  return db.prepare('SELECT role FROM users WHERE username = ?').get(username).role;
}

describe('migrateUserRoles', () => {
  it('adds a nullable role column', () => {
    const db = oldSchemaDb([]);
    migrateUserRoles(db, quiet);

    const role = db.prepare('PRAGMA table_info(users)').all().find(c => c.name === 'role');
    expect(role).toBeDefined();
    expect(role.notnull).toBe(0);

    db.prepare("INSERT INTO users (username, password) VALUES ('new', 'x')").run();
    expect(roleOf(db, 'new')).toBeNull();
  });

  it('backfills pro and enterprise users to trusted', () => {
    const db = oldSchemaDb([['p', 'pro'], ['e', 'enterprise'], ['f', 'free'], ['n', null]]);
    migrateUserRoles(db, quiet);

    expect(roleOf(db, 'p')).toBe('trusted');
    expect(roleOf(db, 'e')).toBe('trusted');
    expect(roleOf(db, 'f')).toBeNull();
    expect(roleOf(db, 'n')).toBeNull();
  });

  it('leaves the tier column in place', () => {
    const db = oldSchemaDb([['p', 'pro']]);
    migrateUserRoles(db, quiet);

    expect(db.prepare("SELECT tier FROM users WHERE username = 'p'").get().tier).toBe('pro');
  });

  it('backfills only once, so a role reset to default is not re-promoted on the next start', () => {
    const db = oldSchemaDb([['p', 'pro']]);
    migrateUserRoles(db, quiet);

    db.prepare("UPDATE users SET role = NULL WHERE username = 'p'").run();
    migrateUserRoles(db, quiet);

    expect(roleOf(db, 'p')).toBeNull();
  });

  it('works on a fresh database without a tier column', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password TEXT)');

    expect(() => migrateUserRoles(db, quiet)).not.toThrow();
    expect(db.prepare('PRAGMA table_info(users)').all().map(c => c.name)).toContain('role');
  });
});

describe('migrateAnalyticsShareLinks', () => {
  const { migrateAnalyticsShareLinks } = require('../../../config/migrations');

  function baseDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
      CREATE TABLE urls (id INTEGER PRIMARY KEY, slug TEXT);
      INSERT INTO users (id, username) VALUES (1, 'owner');
      INSERT INTO urls (id, slug) VALUES (1, 'abc');
    `);
    return db;
  }

  const columns = (db) => db.prepare('PRAGMA table_info(analytics_shares)').all().map(c => c.name);

  it('creates the share-link table on a fresh database', () => {
    const db = baseDb();
    migrateAnalyticsShareLinks(db, quiet);

    expect(columns(db)).toEqual(expect.arrayContaining(['urlId', 'createdBy', 'tokenHash', 'label', 'expiresAt', 'viewCount']));
    expect(columns(db)).not.toContain('sharedWith');
  });

  it('replaces the old user-to-user table, dropping its rows', () => {
    const db = baseDb();
    db.exec(`
      CREATE TABLE analytics_shares (
        id INTEGER PRIMARY KEY, urlId INTEGER, sharedBy INTEGER, sharedWith TEXT,
        role TEXT, permissions TEXT, expiresAt DATETIME, createdAt DATETIME
      );
      INSERT INTO analytics_shares (urlId, sharedBy, sharedWith, role) VALUES (1, 1, 'bob', 'viewer');
    `);

    migrateAnalyticsShareLinks(db, quiet);

    expect(columns(db)).toContain('tokenHash');
    expect(columns(db)).not.toContain('sharedWith');
    expect(db.prepare('SELECT COUNT(*) AS n FROM analytics_shares').get().n).toBe(0);
  });

  it('keeps existing share links on later starts', () => {
    const db = baseDb();
    migrateAnalyticsShareLinks(db, quiet);
    db.prepare("INSERT INTO analytics_shares (urlId, createdBy, tokenHash) VALUES (1, 1, 'h')").run();

    migrateAnalyticsShareLinks(db, quiet);

    expect(db.prepare('SELECT COUNT(*) AS n FROM analytics_shares').get().n).toBe(1);
  });

  it('enforces unique token hashes and cascades with the URL', () => {
    const db = baseDb();
    migrateAnalyticsShareLinks(db, quiet);
    const insert = db.prepare("INSERT INTO analytics_shares (urlId, createdBy, tokenHash) VALUES (1, 1, 'same')");
    insert.run();

    expect(() => insert.run()).toThrow(/UNIQUE/);
    db.prepare('DELETE FROM urls WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM analytics_shares').get().n).toBe(0);
  });
});

describe('migrateQuarantine', () => {
  const { migrateQuarantine } = require('../../../config/migrations');

  it('adds isQuarantined (default 0) to urls and bundles, idempotently', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE urls (id INTEGER PRIMARY KEY, slug TEXT);
      CREATE TABLE bundles (id INTEGER PRIMARY KEY, slug TEXT);
      INSERT INTO urls (slug) VALUES ('a');
      INSERT INTO bundles (slug) VALUES ('b');
    `);

    migrateQuarantine(db, quiet);
    migrateQuarantine(db, quiet);

    expect(db.prepare('SELECT isQuarantined FROM urls').get().isQuarantined).toBe(0);
    expect(db.prepare('SELECT isQuarantined FROM bundles').get().isQuarantined).toBe(0);
  });
});

describe('migrateDropNotifications', () => {
  const { migrateDropNotifications } = require('../../../config/migrations');
  const exists = (db) => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").get();

  it('drops the notifications table and is safe to run again', () => {
    const db = new Database(':memory:');
    db.exec("CREATE TABLE notifications (id INTEGER PRIMARY KEY, userId INTEGER, message TEXT); INSERT INTO notifications (message) VALUES ('hi');");

    migrateDropNotifications(db, quiet);
    expect(exists(db)).toBe(false);
    expect(() => migrateDropNotifications(db, quiet)).not.toThrow();
  });
});
