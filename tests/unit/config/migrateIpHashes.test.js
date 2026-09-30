const crypto = require('crypto');
const Database = require('better-sqlite3');
const { migrateIpHashes } = require('../../../config/migrations');
const ipHash = require('../../../services/ipHash');

// Old databases store plain SHA-256 IP hashes. migrateIpHashes rewraps each one with
// the secret, once, into exactly what a new visit from that IP is stored as: unique
// visitors and the one-report-per-IP check carry on, and none of the old hashes can
// be reversed without the secret any more.

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const quiet = () => ({ log: jest.fn(), warn: jest.fn() });

let saved;
beforeEach(() => { saved = process.env.IP_HASH_SECRET; });
afterEach(() => { process.env.IP_HASH_SECRET = saved; });

function oldDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, targetType TEXT NOT NULL, targetId INTEGER NOT NULL,
      subTargetId INTEGER, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, ipHash TEXT
    );
    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, targetType TEXT NOT NULL, targetId INTEGER NOT NULL,
      reporterIpHash TEXT NOT NULL, reason TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_reports_unique_reporter ON reports(targetType, targetId, reporterIpHash);
  `);
  const event = db.prepare("INSERT INTO analytics_events (targetType, targetId, ipHash) VALUES ('url', 1, ?)");
  for (const ip of ['198.51.100.1', '198.51.100.1', '198.51.100.2']) event.run(sha256(ip));
  event.run(null);
  const report = db.prepare("INSERT INTO reports (targetType, targetId, reporterIpHash, reason) VALUES ('url', ?, ?, 'SPAM')");
  report.run(1, sha256('203.0.113.9'));
  report.run(2, sha256('203.0.113.9'));
  return db;
}

const eventHashes = (db) => db.prepare('SELECT ipHash FROM analytics_events ORDER BY id').all().map(r => r.ipHash);
const reportHashes = (db) => db.prepare('SELECT reporterIpHash FROM reports ORDER BY id').all().map(r => r.reporterIpHash);
const meta = (db, key) => (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) || {}).value;

describe('migrateIpHashes', () => {
  it('rewraps every stored hash into what a new visit from that IP is stored as', () => {
    const db = oldDb();

    migrateIpHashes(db, quiet());

    expect(eventHashes(db)).toEqual([
      ipHash.hashIp('198.51.100.1'), ipHash.hashIp('198.51.100.1'), ipHash.hashIp('198.51.100.2'), null
    ]);
    expect(reportHashes(db)).toEqual([ipHash.hashIp('203.0.113.9'), ipHash.hashIp('203.0.113.9')]);
  });

  it('keeps unique visitors: the same IPs stay equal, different ones stay apart', () => {
    const db = oldDb();
    migrateIpHashes(db, quiet());
    expect(db.prepare('SELECT COUNT(DISTINCT ipHash) AS n FROM analytics_events').get().n).toBe(2);
  });

  it('leaves no plain SHA-256 hash behind', () => {
    const db = oldDb();
    migrateIpHashes(db, quiet());

    const plain = ['198.51.100.1', '198.51.100.2', '203.0.113.9'].map(sha256);
    for (const hash of [...eventHashes(db), ...reportHashes(db)]) expect(plain).not.toContain(hash);
  });

  it('records the scheme and the secret fingerprint', () => {
    const db = oldDb();
    migrateIpHashes(db, quiet());
    expect(meta(db, 'ipHashScheme')).toBe(ipHash.SCHEME);
    expect(meta(db, 'ipHashKeyFingerprint')).toBe(ipHash.fingerprint());
  });

  it('runs once: a second start changes nothing', () => {
    const db = oldDb();
    migrateIpHashes(db, quiet());
    const events = eventHashes(db);
    const reports = reportHashes(db);

    const logger = quiet();
    migrateIpHashes(db, logger);

    expect(eventHashes(db)).toEqual(events);
    expect(reportHashes(db)).toEqual(reports);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('marks a new database without touching anything', () => {
    const db = new Database(':memory:');
    migrateIpHashes(db, quiet());
    expect(meta(db, 'ipHashScheme')).toBe(ipHash.SCHEME);
  });

  it('warns once when the secret changed, and leaves the stored hashes alone', () => {
    const db = oldDb();
    migrateIpHashes(db, quiet());
    const events = eventHashes(db);

    process.env.IP_HASH_SECRET = 'another-secret-'.padEnd(64, 'y');
    const logger = quiet();
    migrateIpHashes(db, logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatch(/IP_HASH_SECRET changed/);
    expect(eventHashes(db)).toEqual(events);
    expect(meta(db, 'ipHashKeyFingerprint')).toBe(ipHash.fingerprint());

    const again = quiet();
    migrateIpHashes(db, again);
    expect(again.warn).not.toHaveBeenCalled();
  });

  it('changes nothing when the secret is missing (startup stops before)', () => {
    const db = oldDb();
    const before = eventHashes(db);
    process.env.IP_HASH_SECRET = '';

    expect(() => migrateIpHashes(db, quiet())).toThrow(/IP_HASH_SECRET/);
    expect(eventHashes(db)).toEqual(before);
  });
});
