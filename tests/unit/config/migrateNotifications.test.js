const Database = require('better-sqlite3');
const { migrateNotifications, migrateDropNotifications } = require('../../../config/migrations');

// Notifications: one table is both the in-app list and the mail queue; preferences store only what a user changed.

function baseDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL);
    INSERT INTO users (username) VALUES ('ann'), ('bob');
  `);
  return db;
}

const quiet = { log: () => {} };
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const insert = (db, values = {}) => db.prepare(`
  INSERT INTO notifications (userId, event, targetType, targetId, payload, inApp, mailState, mailAfter, dedupeKey)
  VALUES (@userId, @event, @targetType, @targetId, @payload, @inApp, @mailState, @mailAfter, @dedupeKey)
`).run({
  userId: 1, event: 'blocked', targetType: 'url', targetId: 5, payload: '{}', inApp: 1, mailState: 'none',
  mailAfter: null, dedupeKey: null, ...values
});

describe('migrateNotifications', () => {
  let db;
  beforeEach(() => {
    db = baseDb();
    migrateNotifications(db, quiet);
  });

  it('creates notifications with the queue and read columns', () => {
    expect(columns(db, 'notifications')).toEqual(expect.arrayContaining([
      'id', 'userId', 'event', 'targetType', 'targetId', 'payload', 'inApp', 'mailState', 'mailAfter', 'dedupeKey',
      'createdAt', 'readAt', 'mailedAt'
    ]));
    insert(db);
    const row = db.prepare('SELECT * FROM notifications').get();
    expect(row.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(row.readAt).toBeNull();
  });

  it('allows one row per dedupe key, any number without one', () => {
    insert(db, { dedupeKey: 'expires_soon:url:5' });
    expect(() => insert(db, { dedupeKey: 'expires_soon:url:5' })).toThrow(/UNIQUE/);
    insert(db);
    insert(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(3);
  });

  it('refuses an unknown mail state', () => {
    expect(() => insert(db, { mailState: 'maybe' })).toThrow(/CHECK/);
  });

  it('deletes a user\'s notifications and preferences with the user', () => {
    insert(db);
    db.prepare("INSERT INTO notification_preferences (userId, event, inApp, mail) VALUES (1, 'blocked', 1, 0)").run();
    db.prepare('DELETE FROM users WHERE id = 1').run();
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notification_preferences').get().n).toBe(0);
  });

  it('keeps one preference row per user and event', () => {
    db.prepare("INSERT INTO notification_preferences (userId, event, inApp, mail) VALUES (1, 'blocked', 1, 0)").run();
    expect(() => db.prepare("INSERT INTO notification_preferences (userId, event, inApp, mail) VALUES (1, 'blocked', 0, 0)").run())
      .toThrow(/UNIQUE|PRIMARY/);
  });

  it('adds users.notificationKey (for unsubscribe links), unique, empty until needed', () => {
    expect(columns(db, 'users')).toContain('notificationKey');
    db.prepare("UPDATE users SET notificationKey = 'k' WHERE id = 1").run();
    expect(() => db.prepare("UPDATE users SET notificationKey = 'k' WHERE id = 2").run()).toThrow(/UNIQUE/);
  });

  it('is idempotent and keeps the rows', () => {
    insert(db);
    expect(() => migrateNotifications(db, quiet)).not.toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(1);
  });

  it('is not dropped by migrateDropNotifications (which removes only the old table)', () => {
    insert(db);
    migrateDropNotifications(db, quiet);
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(1);
  });
});

describe('the old notifications table', () => {
  it('is dropped first, then the new one is created', () => {
    const db = baseDb();
    db.exec(`CREATE TABLE notifications (id INTEGER PRIMARY KEY, userId INTEGER, type TEXT, title TEXT, message TEXT,
      metadata TEXT, isRead INTEGER DEFAULT 0, isSent INTEGER DEFAULT 0, sentAt DATETIME, createdAt DATETIME);
      INSERT INTO notifications (userId, type, title, message) VALUES (1, 'x', 'Hi', 'old');`);
    migrateDropNotifications(db, quiet);
    migrateNotifications(db, quiet);
    expect(columns(db, 'notifications')).toContain('mailState');
    expect(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n).toBe(0);
  });
});
