const Database = require('better-sqlite3');
const { migrateAnalytics } = require('../../../config/migrations');

const quiet = { log: () => {} };

// An old-schema database: the four per-type analytics tables and the link-only
// analytics_shares, next to the content tables.
function oldSchemaDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE bundle_items (id INTEGER PRIMARY KEY AUTOINCREMENT, bundleId INTEGER NOT NULL,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE);
    CREATE TABLE pastes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, urlId INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT, referrer TEXT, userAgent TEXT, browser TEXT, os TEXT, device TEXT, country TEXT,
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE);
    CREATE TABLE bundle_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bundleId INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT, referrer TEXT, userAgent TEXT, browser TEXT, os TEXT, device TEXT, country TEXT,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE);
    CREATE TABLE bundle_item_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bundleItemId INTEGER NOT NULL, bundleId INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ipHash TEXT,
      FOREIGN KEY (bundleItemId) REFERENCES bundle_items(id) ON DELETE CASCADE,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE);
    CREATE TABLE paste_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, pasteId INTEGER NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT, referrer TEXT, userAgent TEXT, browser TEXT, os TEXT, device TEXT, country TEXT,
      FOREIGN KEY (pasteId) REFERENCES pastes(id) ON DELETE CASCADE);
    CREATE TABLE analytics_shares (
      id INTEGER PRIMARY KEY AUTOINCREMENT, urlId INTEGER NOT NULL, createdBy INTEGER, tokenHash TEXT NOT NULL UNIQUE,
      label TEXT, expiresAt DATETIME, viewCount INTEGER NOT NULL DEFAULT 0, lastViewedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL);
    CREATE INDEX idx_analytics_shares_urlId ON analytics_shares(urlId);

    INSERT INTO users (username) VALUES ('owner');
    INSERT INTO urls (slug) VALUES ('u1'), ('u2');
    INSERT INTO bundles (slug) VALUES ('b1');
    INSERT INTO bundle_items (bundleId) VALUES (1), (1);
    INSERT INTO pastes (slug) VALUES ('p1');
    INSERT INTO files (slug) VALUES ('f1');
  `);
  return db;
}

const COUNTRIES = ['Switzerland', 'Germany', 'Unknown'];
const REFERRERS = ['Direct', 'https://news.example', 'https://social.example'];

// A realistic spread: several days, repeat visitors, every breakdown column filled
function seed(db) {
  const full = (table, fk) => db.prepare(`
    INSERT INTO ${table} (id, ${fk}, timestamp, ipHash, referrer, userAgent, browser, os, device, country)
    VALUES (?, ?, ?, ?, ?, 'UA', ?, ?, ?, ?)`);
  const url = full('analytics', 'urlId');
  const bundle = full('bundle_analytics', 'bundleId');
  const paste = full('paste_analytics', 'pasteId');
  const item = db.prepare('INSERT INTO bundle_item_analytics (id, bundleItemId, bundleId, timestamp, ipHash) VALUES (?, ?, ?, ?, ?)');

  for (let i = 1; i <= 40; i++) {
    const day = `2026-0${1 + (i % 3)}-${String(1 + (i % 7)).padStart(2, '0')} 1${i % 10}:00:00`;
    const row = [day, `ip${i % 9}`, REFERRERS[i % 3], ['Chrome', 'Firefox'][i % 2], ['Windows', 'Linux'][i % 2],
      ['Desktop', 'Mobile'][i % 2], COUNTRIES[i % 3]];
    url.run(100 + i, 1 + (i % 2), ...row);
    if (i <= 15) bundle.run(i, 1, ...row);
    if (i <= 8) paste.run(i, 1, ...row);
    if (i <= 12) item.run(i, 1 + (i % 2), 1, day, `ip${i % 4}`);
  }
  db.prepare("INSERT INTO analytics_shares (id, urlId, createdBy, tokenHash, label, expiresAt, viewCount, lastViewedAt, createdAt) VALUES (7, 2, 1, 'hash7', 'For the client', '2999-01-01T00:00:00.000Z', 4, '2026-03-01 10:00:00', '2026-02-01 09:00:00')").run();
}

// The numbers an analytics page shows for one item, computed straight from a table
function numbers(db, table, where, params) {
  const q = (sql) => db.prepare(sql).all(...params);
  return {
    total: q(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)[0].n,
    unique: q(`SELECT COUNT(DISTINCT ipHash) AS n FROM ${table} WHERE ${where}`)[0].n,
    byDay: q(`SELECT DATE(timestamp) AS d, COUNT(*) AS n FROM ${table} WHERE ${where} GROUP BY d ORDER BY d`),
    byCountry: q(`SELECT country, COUNT(*) AS n FROM ${table} WHERE ${where} GROUP BY country ORDER BY country`),
    byReferrer: q(`SELECT referrer, COUNT(*) AS n FROM ${table} WHERE ${where} GROUP BY referrer ORDER BY referrer`),
    byBrowser: q(`SELECT browser, os, device, COUNT(*) AS n FROM ${table} WHERE ${where} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`)
  };
}

const EVENTS = 'analytics_events';
const main = 'targetType = ? AND targetId = ? AND subTargetId IS NULL';

describe('migrateAnalytics', () => {
  it.each([
    ['link 1', 'analytics', 'urlId = ?', [1], 'url', 1],
    ['link 2', 'analytics', 'urlId = ?', [2], 'url', 2],
    ['bundle', 'bundle_analytics', 'bundleId = ?', [1], 'bundle', 1],
    ['paste', 'paste_analytics', 'pasteId = ?', [1], 'paste', 1]
  ])('%s: every number on its analytics page is the same afterwards', (_name, table, where, params, type, id) => {
    const db = oldSchemaDb();
    seed(db);
    const before = numbers(db, table, where, params);

    migrateAnalytics(db, quiet);

    expect(numbers(db, EVENTS, main, [type, id])).toEqual(before);
    expect(before.total).toBeGreaterThan(0);
  });

  it('bundle item clicks become sub-item events of their bundle, per item', () => {
    const db = oldSchemaDb();
    seed(db);
    const before = db.prepare('SELECT bundleItemId AS item, COUNT(*) AS n, COUNT(DISTINCT ipHash) AS u FROM bundle_item_analytics GROUP BY 1 ORDER BY 1').all();

    migrateAnalytics(db, quiet);

    const after = db.prepare(`SELECT subTargetId AS item, COUNT(*) AS n, COUNT(DISTINCT ipHash) AS u FROM ${EVENTS}
      WHERE targetType = 'bundle' AND targetId = 1 AND subTargetId IS NOT NULL GROUP BY 1 ORDER BY 1`).all();
    expect(after).toEqual(before);
  });

  it('keeps the IDs of link events', () => {
    const db = oldSchemaDb();
    seed(db);
    const ids = db.prepare('SELECT id FROM analytics ORDER BY id').all().map(r => r.id);
    migrateAnalytics(db, quiet);
    expect(db.prepare(`SELECT id FROM ${EVENTS} WHERE targetType = 'url' ORDER BY id`).all().map(r => r.id)).toEqual(ids);
  });

  it('moves share links to type + item, keeping every field', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateAnalytics(db, quiet);

    expect(db.prepare('SELECT * FROM analytics_shares').all()).toEqual([expect.objectContaining({
      id: 7, targetType: 'url', targetId: 2, createdBy: 1, tokenHash: 'hash7', label: 'For the client',
      expiresAt: '2999-01-01T00:00:00.000Z', viewCount: 4, lastViewedAt: '2026-03-01 10:00:00', createdAt: '2026-02-01 09:00:00'
    })]);
    const columns = db.prepare('PRAGMA table_info(analytics_shares)').all().map(c => c.name);
    expect(columns).not.toContain('urlId');
  });

  it('drops the old tables, and a second run changes nothing', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateAnalytics(db, quiet);
    const events = db.prepare(`SELECT COUNT(*) AS n FROM ${EVENTS}`).get().n;
    migrateAnalytics(db, quiet);

    for (const table of ['analytics', 'bundle_analytics', 'bundle_item_analytics', 'paste_analytics']) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table)).toBeUndefined();
    }
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${EVENTS}`).get().n).toBe(events);
    expect(events).toBe(40 + 15 + 8 + 12);
  });

  it('creates the tables on a fresh database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE urls (id INTEGER PRIMARY KEY);
      CREATE TABLE bundles (id INTEGER PRIMARY KEY);
      CREATE TABLE bundle_items (id INTEGER PRIMARY KEY, bundleId INTEGER);
      CREATE TABLE pastes (id INTEGER PRIMARY KEY);
      CREATE TABLE files (id INTEGER PRIMARY KEY);
    `);
    migrateAnalytics(db, quiet);

    const columns = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
    expect(columns(EVENTS)).toEqual(expect.arrayContaining(['targetType', 'targetId', 'subTargetId', 'timestamp', 'ipHash', 'country']));
    expect(columns('analytics_shares')).toEqual(expect.arrayContaining(['targetType', 'targetId', 'tokenHash']));
  });

  it.each([
    ['url', 'urls'], ['bundle', 'bundles'], ['paste', 'pastes'], ['file', 'files']
  ])('deleting a %s deletes its events and share links, and only its own', (type, table) => {
    const db = oldSchemaDb();
    migrateAnalytics(db, quiet);
    const other = type === 'url' ? 'paste' : 'url';
    const event = db.prepare(`INSERT INTO ${EVENTS} (targetType, targetId) VALUES (?, 1)`);
    const share = db.prepare('INSERT INTO analytics_shares (targetType, targetId, tokenHash) VALUES (?, 1, ?)');
    event.run(type); event.run(other);
    share.run(type, 't1'); share.run(other, 't2');

    db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();

    expect(db.prepare(`SELECT targetType FROM ${EVENTS}`).all().map(r => r.targetType)).toEqual([other]);
    expect(db.prepare('SELECT targetType FROM analytics_shares').all().map(r => r.targetType)).toEqual([other]);
  });

  it('deleting a bundle item deletes its click events, not the bundle\'s', () => {
    const db = oldSchemaDb();
    migrateAnalytics(db, quiet);
    const event = db.prepare(`INSERT INTO ${EVENTS} (targetType, targetId, subTargetId) VALUES ('bundle', 1, ?)`);
    event.run(null); event.run(1); event.run(2);

    db.prepare('DELETE FROM bundle_items WHERE id = 1').run();

    expect(db.prepare(`SELECT subTargetId FROM ${EVENTS} ORDER BY id`).all().map(r => r.subTargetId)).toEqual([null, 2]);
  });
});
