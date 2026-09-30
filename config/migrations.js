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
  for (const table of ['urls', 'bundles', 'pastes', 'files']) {
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

/**
 * One reports table for every content type (targetType + targetId), replacing
 * url_reports and bundle_reports. Existing rows are copied, then the old tables are
 * dropped, in one transaction:
 * - link reports keep their IDs (audit entries refer to them); bundle reports get new
 *   IDs, recorded old → new in one MIGRATE_REPORTS audit entry
 * - the legacy raw reporterIp column is not copied
 * - of duplicate reports (same item, same reporter) only the oldest is kept; a unique
 *   index allows one report per reporter per item from then on
 * The table can't have a foreign key to four item tables, so triggers delete an
 * item's reports when the item is deleted.
 */
const REPORT_TARGETS = { url: 'urls', bundle: 'bundles', paste: 'pastes', file: 'files' };

function migrateReports(db, logger = console) {
  const tableExists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);

  // Old rows to copy: all columns but the raw IP, without the newer duplicates
  const oldRows = (table, fk) => db.prepare(`
    SELECT r.id, r.${fk} AS targetId, r.reporterIpHash, r.reason, r.description, r.status,
           r.reviewedBy, r.reviewedAt, r.createdAt
    FROM ${table} r
    WHERE NOT EXISTS (
      SELECT 1 FROM ${table} older
      WHERE older.${fk} = r.${fk} AND older.reporterIpHash = r.reporterIpHash
        AND (older.createdAt < r.createdAt OR (older.createdAt = r.createdAt AND older.id < r.id))
    )
    ORDER BY r.id
  `).all();

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        targetType TEXT NOT NULL,
        targetId INTEGER NOT NULL,
        reporterIpHash TEXT NOT NULL,
        reason TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        reviewedBy INTEGER,
        reviewedAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reviewedBy) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_reporter ON reports(targetType, targetId, reporterIpHash);
      CREATE INDEX IF NOT EXISTS idx_reports_target_status ON reports(targetType, targetId, status);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_reports_createdAt ON reports(createdAt);
    `);

    for (const [type, table] of Object.entries(REPORT_TARGETS)) {
      if (!tableExists(table)) continue;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_reports_delete_${table} AFTER DELETE ON ${table}
        BEGIN
          DELETE FROM reports WHERE targetType = '${type}' AND targetId = OLD.id;
        END;
      `);
    }

    const insert = (withId) => db.prepare(`
      INSERT INTO reports (${withId ? 'id, ' : ''}targetType, targetId, reporterIpHash, reason, description,
                           status, reviewedBy, reviewedAt, createdAt)
      VALUES (${withId ? '@id, ' : ''}@targetType, @targetId, @reporterIpHash, @reason, @description,
              COALESCE(@status, 'pending'), @reviewedBy, @reviewedAt, COALESCE(@createdAt, CURRENT_TIMESTAMP))
    `);

    if (tableExists('url_reports')) {
      const rows = oldRows('url_reports', 'urlId');
      logger.log(`  🚨 Moving ${rows.length} link report(s) into reports...`);
      const insertWithId = insert(true);
      for (const row of rows) insertWithId.run({ ...row, targetType: 'url' });
      db.exec('DROP TABLE url_reports');
    }

    if (tableExists('bundle_reports')) {
      const rows = oldRows('bundle_reports', 'bundleId');
      logger.log(`  🚨 Moving ${rows.length} bundle report(s) into reports...`);
      const insertNew = insert(false);
      const bundleReportIds = {};
      for (const { id, ...row } of rows) {
        bundleReportIds[id] = Number(insertNew.run({ ...row, targetType: 'bundle' }).lastInsertRowid);
      }
      if (rows.length && tableExists('audit_logs')) {
        db.prepare(`
          INSERT INTO audit_logs (action, category, targetType, targetDescription, details)
          VALUES ('MIGRATE_REPORTS', 'ADMIN_ACTION', 'report', 'Bundle reports moved into the reports table', ?)
        `).run(JSON.stringify({ bundleReportIds }));
      }
      db.exec('DROP TABLE bundle_reports');
    }
  })();
}

/**
 * One analytics_events table for every content type (targetType + targetId, and
 * subTargetId for a bundle item click), replacing analytics, bundle_analytics,
 * bundle_item_analytics and paste_analytics; and analytics_shares moves from urlId
 * to targetType + targetId. Rows are copied, then the old tables dropped, in one
 * transaction. Link events keep their IDs. Triggers delete an item's events and
 * share links with the item, and a bundle item's click events with the item.
 */
const OLD_ANALYTICS = [
  // [table, targetType, target column, sub-target column, has the visit details]
  ['analytics', 'url', 'urlId', null, true],
  ['bundle_analytics', 'bundle', 'bundleId', null, true],
  ['bundle_item_analytics', 'bundle', 'bundleId', 'bundleItemId', false],
  ['paste_analytics', 'paste', 'pasteId', null, true]
];

function migrateAnalytics(db, logger = console) {
  const tableExists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        targetType TEXT NOT NULL,
        targetId INTEGER NOT NULL,
        subTargetId INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        ipHash TEXT,
        referrer TEXT,
        userAgent TEXT,
        browser TEXT,
        os TEXT,
        device TEXT,
        country TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_events_target ON analytics_events(targetType, targetId, timestamp);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_sub ON analytics_events(targetType, targetId, subTargetId);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp);
    `);

    for (const [table, type, fk, subFk, details] of OLD_ANALYTICS) {
      if (!tableExists(table)) continue;
      const keepId = table === 'analytics';
      const detailColumns = details ? ', referrer, userAgent, browser, os, device, country' : '';
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
      logger.log(`  📊 Moving ${n} ${table} row(s) into analytics_events...`);
      db.exec(`
        INSERT INTO analytics_events (${keepId ? 'id, ' : ''}targetType, targetId, subTargetId, timestamp, ipHash${detailColumns})
        SELECT ${keepId ? 'id, ' : ''}'${type}', ${fk}, ${subFk || 'NULL'}, timestamp, ipHash${detailColumns}
        FROM ${table} ORDER BY id;
        DROP TABLE ${table};
      `);
    }

    // Share links: urlId → targetType + targetId (SQLite can't change columns: rebuild)
    const shareColumns = columns('analytics_shares');
    if (!shareColumns.includes('targetType')) {
      if (shareColumns.length) db.exec('ALTER TABLE analytics_shares RENAME TO analytics_shares_old');
      db.exec(`
        CREATE TABLE analytics_shares (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          targetType TEXT NOT NULL,
          targetId INTEGER NOT NULL,
          createdBy INTEGER,
          tokenHash TEXT NOT NULL UNIQUE,
          label TEXT,
          expiresAt DATETIME,
          viewCount INTEGER NOT NULL DEFAULT 0,
          lastViewedAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
      if (shareColumns.length) {
        logger.log('  🔗 Moving analytics share links to type + item...');
        db.exec(`
          INSERT INTO analytics_shares (id, targetType, targetId, createdBy, tokenHash, label, expiresAt, viewCount, lastViewedAt, createdAt)
          SELECT id, 'url', urlId, createdBy, tokenHash, label, expiresAt, viewCount, lastViewedAt, createdAt
          FROM analytics_shares_old;
          DROP TABLE analytics_shares_old;
        `);
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_analytics_shares_target ON analytics_shares(targetType, targetId);
        CREATE INDEX IF NOT EXISTS idx_analytics_shares_expiresAt ON analytics_shares(expiresAt);
      `);
    }

    for (const [type, table] of Object.entries(REPORT_TARGETS)) {
      if (!tableExists(table)) continue;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_analytics_delete_${table} AFTER DELETE ON ${table}
        BEGIN
          DELETE FROM analytics_events WHERE targetType = '${type}' AND targetId = OLD.id;
          DELETE FROM analytics_shares WHERE targetType = '${type}' AND targetId = OLD.id;
        END;
      `);
    }
    if (tableExists('bundle_items')) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_analytics_delete_bundle_items AFTER DELETE ON bundle_items
        BEGIN
          DELETE FROM analytics_events WHERE targetType = 'bundle' AND subTargetId = OLD.id;
        END;
      `);
    }
  })();
}

module.exports = {
  migrateUserRoles, migrateAnalyticsShareLinks, migrateQuarantine, migrateDropNotifications, migrateReports,
  migrateAnalytics
};
