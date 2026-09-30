const Database = require('better-sqlite3');
const { migrateReports, migrateQuarantine } = require('../../../config/migrations');

const quiet = { log: () => {} };

// An old-schema database: url_reports (with the legacy raw reporterIp column) and
// bundle_reports, next to the four content tables and audit_logs.
function oldSchemaDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT);
    CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE bundles (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE pastes (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, username TEXT, action TEXT NOT NULL,
      category TEXT NOT NULL, targetType TEXT, targetId INTEGER, targetDescription TEXT,
      ipAddress TEXT, userAgent TEXT, details TEXT, createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE url_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      urlId INTEGER NOT NULL,
      reporterIp TEXT,
      reporterIpHash TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      reviewedBy INTEGER,
      reviewedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewedBy) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE bundle_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundleId INTEGER NOT NULL,
      reporterIpHash TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewedBy INTEGER,
      reviewedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewedBy) REFERENCES users(id) ON DELETE SET NULL
    );
    INSERT INTO users (username) VALUES ('admin');
    INSERT INTO urls (slug) VALUES ('u1'), ('u2');
    INSERT INTO bundles (slug) VALUES ('b1');
    INSERT INTO pastes (slug) VALUES ('p1');
    INSERT INTO files (slug) VALUES ('f1');
  `);
  return db;
}

const tableExists = (db, name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
const reports = (db) => db.prepare('SELECT * FROM reports ORDER BY id').all();

function seed(db) {
  const url = db.prepare(`
    INSERT INTO url_reports (id, urlId, reporterIp, reporterIpHash, reason, description, status, reviewedBy, reviewedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  url.run(5, 1, '203.0.113.9', 'hashA', 'SPAM', 'lots of spam', 'reviewed', 1, '2026-01-02 10:00:00', '2026-01-01 09:00:00');
  url.run(9, 2, null, 'hashB', 'PHISHING', null, 'pending', null, null, '2026-01-03 09:00:00');

  const bundle = db.prepare(`
    INSERT INTO bundle_reports (id, bundleId, reporterIpHash, reason, description, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  bundle.run(3, 1, 'hashC', 'MALWARE', 'bad file inside', 'pending', '2026-01-04 09:00:00');
  bundle.run(4, 1, 'hashD', 'FRAUD', null, 'dismissed', '2026-01-05 09:00:00');
}

describe('migrateReports', () => {
  it('moves every link and bundle report into reports, fields intact', () => {
    const db = oldSchemaDb();
    seed(db);

    migrateReports(db, quiet);

    const rows = reports(db);
    expect(rows).toHaveLength(4);
    expect(rows.find(r => r.targetType === 'url' && r.targetId === 1)).toEqual(expect.objectContaining({
      reporterIpHash: 'hashA', reason: 'SPAM', description: 'lots of spam', status: 'reviewed',
      reviewedBy: 1, reviewedAt: '2026-01-02 10:00:00', createdAt: '2026-01-01 09:00:00'
    }));
    expect(rows.find(r => r.targetType === 'bundle' && r.reporterIpHash === 'hashC')).toEqual(expect.objectContaining({
      targetId: 1, reason: 'MALWARE', description: 'bad file inside', status: 'pending', createdAt: '2026-01-04 09:00:00'
    }));
  });

  it('keeps link-report IDs, so audit entries about them still match', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateReports(db, quiet);

    const urlIds = reports(db).filter(r => r.targetType === 'url').map(r => r.id);
    expect(urlIds).toEqual([5, 9]);
  });

  it('gives bundle reports new IDs and records the old → new mapping in one audit entry', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateReports(db, quiet);

    const bundleRows = reports(db).filter(r => r.targetType === 'bundle');
    for (const row of bundleRows) expect([5, 9]).not.toContain(row.id);

    const audit = db.prepare("SELECT * FROM audit_logs WHERE action = 'MIGRATE_REPORTS'").all();
    expect(audit).toHaveLength(1);
    const { bundleReportIds } = JSON.parse(audit[0].details);
    const byHash = Object.fromEntries(bundleRows.map(r => [r.reporterIpHash, r.id]));
    expect(bundleReportIds).toEqual({ 3: byHash.hashC, 4: byHash.hashD });
  });

  it('writes no audit entry when there were no bundle reports', () => {
    const db = oldSchemaDb();
    db.prepare("INSERT INTO url_reports (urlId, reporterIpHash, reason) VALUES (1, 'h', 'SPAM')").run();
    migrateReports(db, quiet);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n).toBe(0);
  });

  it('does not copy the legacy raw reporterIp column', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateReports(db, quiet);

    const columns = db.prepare('PRAGMA table_info(reports)').all().map(c => c.name);
    expect(columns).not.toContain('reporterIp');
    expect(JSON.stringify(reports(db))).not.toContain('203.0.113.9');
  });

  it('keeps only the oldest of duplicate reports (same item, same reporter)', () => {
    const db = oldSchemaDb();
    const insert = db.prepare("INSERT INTO url_reports (urlId, reporterIpHash, reason, createdAt) VALUES (1, 'same', ?, ?)");
    insert.run('SPAM', '2026-01-01 09:00:00');
    insert.run('FRAUD', '2026-01-02 09:00:00');

    migrateReports(db, quiet);

    const rows = reports(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('SPAM');
  });

  it('drops the old tables and does nothing on a second run', () => {
    const db = oldSchemaDb();
    seed(db);
    migrateReports(db, quiet);
    migrateReports(db, quiet);

    expect(tableExists(db, 'url_reports')).toBe(false);
    expect(tableExists(db, 'bundle_reports')).toBe(false);
    expect(reports(db)).toHaveLength(4);
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n).toBe(1);
  });

  it('creates the table on a fresh database', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE urls (id INTEGER PRIMARY KEY);
      CREATE TABLE bundles (id INTEGER PRIMARY KEY);
      CREATE TABLE pastes (id INTEGER PRIMARY KEY);
      CREATE TABLE files (id INTEGER PRIMARY KEY);
    `);
    migrateReports(db, quiet);
    expect(tableExists(db, 'reports')).toBe(true);
    expect(reports(db)).toEqual([]);
  });

  it('allows one report per reporter per item', () => {
    const db = oldSchemaDb();
    migrateReports(db, quiet);
    const insert = db.prepare('INSERT INTO reports (targetType, targetId, reporterIpHash, reason) VALUES (?, ?, ?, ?)');

    insert.run('url', 1, 'h', 'SPAM');
    expect(() => insert.run('url', 1, 'h', 'FRAUD')).toThrow(/UNIQUE/);
    expect(() => insert.run('url', 2, 'h', 'SPAM')).not.toThrow();
    expect(() => insert.run('paste', 1, 'h', 'SPAM')).not.toThrow();
  });

  it.each([
    ['url', 'urls'], ['bundle', 'bundles'], ['paste', 'pastes'], ['file', 'files']
  ])('deleting a %s deletes its reports, and only its own', (type, table) => {
    const db = oldSchemaDb();
    migrateReports(db, quiet);
    const insert = db.prepare('INSERT INTO reports (targetType, targetId, reporterIpHash, reason) VALUES (?, ?, ?, ?)');
    insert.run(type, 1, 'h1', 'SPAM');
    insert.run(type === 'url' ? 'paste' : 'url', 1, 'h2', 'SPAM'); // same id, other type

    db.prepare(`DELETE FROM ${table} WHERE id = 1`).run();

    expect(reports(db).map(r => r.targetType)).toEqual([type === 'url' ? 'paste' : 'url']);
  });
});

describe('migrateQuarantine (pastes and files)', () => {
  it('adds isQuarantined to pastes and files too', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE urls (id INTEGER PRIMARY KEY);
      CREATE TABLE bundles (id INTEGER PRIMARY KEY);
      CREATE TABLE pastes (id INTEGER PRIMARY KEY, slug TEXT);
      CREATE TABLE files (id INTEGER PRIMARY KEY, slug TEXT);
      INSERT INTO pastes (slug) VALUES ('p');
      INSERT INTO files (slug) VALUES ('f');
    `);
    migrateQuarantine(db, quiet);
    migrateQuarantine(db, quiet);

    expect(db.prepare('SELECT isQuarantined FROM pastes').get().isQuarantined).toBe(0);
    expect(db.prepare('SELECT isQuarantined FROM files').get().isQuarantined).toBe(0);
  });
});
