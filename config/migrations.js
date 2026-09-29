/**
 * Migrations that need to be testable on their own. Each takes the db handle,
 * is idempotent, and is called from config/database.js on startup.
 */

/**
 * Add users.role (NULL means the defaultRole) and move paid-tier users to `trusted`.
 * The backfill runs only when the column is first added, so an admin who later
 * resets a user to the default role isn't overruled on the next start.
 * The legacy tier column is left in place but no longer read.
 */
function migrateUserRoles(db, logger = console) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (columns.includes('role')) return;

  logger.log('  👥 Adding role column to users...');
  // One transaction: a crash between the two steps must not leave the column without its backfill.
  db.transaction(() => {
    db.exec('ALTER TABLE users ADD COLUMN role TEXT DEFAULT NULL');
    if (columns.includes('tier')) {
      const { changes } = db.prepare("UPDATE users SET role = 'trusted' WHERE tier IN ('pro', 'enterprise')").run();
      if (changes) logger.log(`  👥 Moved ${changes} pro/enterprise user(s) to the trusted role`);
    }
  })();
}

/**
 * Analytics share links: read-only, revocable /stats/<token> links. Only the token's
 * SHA-256 hash is stored. Replaces the old user-to-user analytics_shares table;
 * its rows are dropped (there were none in production).
 */
function migrateAnalyticsShareLinks(db, logger = console) {
  const columns = db.prepare('PRAGMA table_info(analytics_shares)').all().map(c => c.name);
  if (columns.includes('tokenHash')) return;

  db.transaction(() => {
    if (columns.length) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM analytics_shares').get();
      logger.log(`  🔗 Replacing user-to-user analytics shares with share links (${n} old share(s) dropped)...`);
      db.exec('DROP TABLE analytics_shares');
    } else {
      logger.log('  🔗 Creating analytics_shares table...');
    }
    db.exec(`
      CREATE TABLE analytics_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        urlId INTEGER NOT NULL,
        createdBy INTEGER,
        tokenHash TEXT NOT NULL UNIQUE,
        label TEXT,
        expiresAt DATETIME,
        viewCount INTEGER NOT NULL DEFAULT 0,
        lastViewedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE,
        FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_analytics_shares_urlId ON analytics_shares(urlId);
      CREATE INDEX idx_analytics_shares_expiresAt ON analytics_shares(expiresAt);
    `);
  })();
}

/**
 * Reports quarantine a link instead of blocking it: urls.isQuarantined and
 * bundles.isQuarantined (0/1). A quarantined link shows visitors a warning first.
 */
function migrateQuarantine(db, logger = console) {
  for (const table of ['urls', 'bundles']) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!columns.length || columns.includes('isQuarantined')) continue;
    logger.log(`  🚧 Adding isQuarantined column to ${table}...`);
    db.exec(`ALTER TABLE ${table} ADD COLUMN isQuarantined INTEGER DEFAULT 0`);
  }
}

/** Notifications were removed (to be redesigned later); drop their table. */
function migrateDropNotifications(db, logger = console) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notifications'").get();
  if (!exists) return;
  logger.log('  🗑️  Dropping notifications table...');
  db.exec('DROP TABLE notifications');
}

module.exports = { migrateUserRoles, migrateAnalyticsShareLinks, migrateQuarantine, migrateDropNotifications };
