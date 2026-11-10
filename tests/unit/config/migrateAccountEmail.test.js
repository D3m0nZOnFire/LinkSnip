const Database = require('better-sqlite3');
const { migrateAccountEmail } = require('../../../config/migrations');

// Verified email addresses (password reset goes only to those) and one-time tokens for verification and reset links.

function oldDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT);
    INSERT INTO users (username, email) VALUES ('ann', 'ann@example.com'), ('bob', 'ANN@example.com'), ('cy', NULL);
  `);
  return db;
}

const column = (db, table, name) => db.prepare(`PRAGMA table_info(${table})`).all().find(c => c.name === name);
const quiet = { log: () => {} };

describe('migrateAccountEmail', () => {
  let db;
  beforeEach(() => {
    db = oldDb();
    migrateAccountEmail(db, quiet);
  });

  it('adds users.emailVerifiedAt; existing addresses start unverified', () => {
    expect(column(db, 'users', 'emailVerifiedAt')).toBeDefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE emailVerifiedAt IS NOT NULL').get().n).toBe(0);
  });

  it('adds users.sessionVersion (0 for everyone)', () => {
    expect(column(db, 'users', 'sessionVersion')).toEqual(expect.objectContaining({ notnull: 1, dflt_value: '0' }));
    expect(db.prepare('SELECT DISTINCT sessionVersion AS v FROM users').all()).toEqual([{ v: 0 }]);
  });

  it('adds users.pendingConfirmation (0: existing accounts never wait)', () => {
    expect(column(db, 'users', 'pendingConfirmation')).toEqual(expect.objectContaining({ notnull: 1, dflt_value: '0' }));
    expect(db.prepare('SELECT DISTINCT pendingConfirmation AS p FROM users').all()).toEqual([{ p: 0 }]);
  });

  it('keeps unverified duplicates (they were allowed before)', () => {
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(3);
  });

  it('allows one verified account per address, ignoring case', () => {
    db.prepare("UPDATE users SET emailVerifiedAt = '2026-01-01' WHERE username = 'ann'").run();
    expect(() => db.prepare("UPDATE users SET emailVerifiedAt = '2026-01-01' WHERE username = 'bob'").run())
      .toThrow(/UNIQUE/);
  });

  it('creates user_tokens, removed with their user', () => {
    db.prepare(`INSERT INTO user_tokens (userId, purpose, tokenHash, expiresAt) VALUES (1, 'reset_password', 'h', '2999-01-01')`).run();
    expect(() => db.prepare(`INSERT INTO user_tokens (userId, purpose, tokenHash, expiresAt) VALUES (2, 'reset_password', 'h', '2999-01-01')`).run())
      .toThrow(/UNIQUE/);
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_tokens').get().n).toBe(0);
  });

  it('refuses an unknown token purpose', () => {
    expect(() => db.prepare(`INSERT INTO user_tokens (userId, purpose, tokenHash, expiresAt) VALUES (1, 'other', 'x', '2999-01-01')`).run())
      .toThrow(/CHECK/);
  });

  it('is idempotent', () => {
    db.prepare("UPDATE users SET emailVerifiedAt = '2026-01-01', sessionVersion = 3 WHERE username = 'ann'").run();
    expect(() => migrateAccountEmail(db, quiet)).not.toThrow();
    expect(db.prepare("SELECT emailVerifiedAt, sessionVersion FROM users WHERE username = 'ann'").get())
      .toEqual({ emailVerifiedAt: '2026-01-01', sessionVersion: 3 });
  });
});
