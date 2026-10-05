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

/**
 * One taggables table (tagId + targetType + targetId) for every content type,
 * replacing url_tags, paste_tags and file_tags; and tag names become unique per
 * user (they were unique across all users, so a second user's "work" failed).
 * Rows are copied, then the old tables dropped, in one transaction. Tags keep
 * their IDs. Deleting a tag removes it from every item (foreign key); triggers
 * remove an item's tags when the item is deleted.
 */
const OLD_TAG_TABLES = [
  // [table, targetType, target column]
  ['url_tags', 'url', 'urlId'],
  ['paste_tags', 'paste', 'pasteId'],
  ['file_tags', 'file', 'fileId']
];

function migrateTags(db, logger = console) {
  const tableExists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const namesUniqueAcrossUsers = () => db.prepare('PRAGMA index_list(tags)').all()
    .filter(index => index.unique)
    .some(index => {
      const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(index.name)})`).all().map(c => c.name);
      return cols.length === 1 && cols[0] === 'name';
    });

  db.transaction(() => {
    // Read the tag assignments out first: dropping the old tags table would cascade into them
    const assignments = [];
    for (const [table, type, fk] of OLD_TAG_TABLES) {
      if (!tableExists(table)) continue;
      const createdAt = columns(table).includes('createdAt') ? 'createdAt' : 'NULL';
      const rows = db.prepare(`SELECT tagId, ${fk} AS targetId, ${createdAt} AS createdAt FROM ${table}`).all();
      logger.log(`  🏷️  Moving ${rows.length} ${table} row(s) into taggables...`);
      assignments.push(...rows.map(row => ({ ...row, targetType: type })));
      db.exec(`DROP TABLE ${table}`);
    }

    if (tableExists('tags') && namesUniqueAcrossUsers()) {
      logger.log('  🏷️  Making tag names unique per user...');
      if (tableExists('taggables')) {
        assignments.push(...db.prepare('SELECT tagId, targetType, targetId, createdAt FROM taggables').all());
        db.exec('DROP TABLE taggables');
      }
      const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'tags'").get();
      db.exec(`
        ALTER TABLE tags RENAME TO tags_old;
        CREATE TABLE tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#34d399',
          userId INTEGER,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (userId, name),
          FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        );
        INSERT INTO tags (id, name, color, userId, createdAt)
        SELECT id, name, color, userId, createdAt FROM tags_old ORDER BY id;
        DROP TABLE tags_old;
      `);
      // Deleted tag IDs stay unused, as AUTOINCREMENT promises
      if (sequence) {
        db.exec("DELETE FROM sqlite_sequence WHERE name = 'tags'");
        db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('tags', ?)").run(sequence.seq);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#34d399',
        userId INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (userId, name),
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      DROP INDEX IF EXISTS idx_tags_name;
      CREATE INDEX IF NOT EXISTS idx_tags_userId ON tags(userId);
      CREATE TABLE IF NOT EXISTS taggables (
        tagId INTEGER NOT NULL,
        targetType TEXT NOT NULL,
        targetId INTEGER NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (tagId, targetType, targetId),
        FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_taggables_target ON taggables(targetType, targetId);
    `);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO taggables (tagId, targetType, targetId, createdAt)
      VALUES (@tagId, @targetType, @targetId, COALESCE(@createdAt, CURRENT_TIMESTAMP))
    `);
    for (const row of assignments) insert.run(row);

    for (const [type, table] of Object.entries(REPORT_TARGETS)) {
      if (!tableExists(table)) continue;
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_taggables_delete_${table} AFTER DELETE ON ${table}
        BEGIN
          DELETE FROM taggables WHERE targetType = '${type}' AND targetId = OLD.id;
        END;
      `);
    }
  })();
}

/**
 * Keyed IP hashes (services/ipHash.js). Old databases store plain SHA-256 hashes,
 * which can be reversed by trying every IPv4 address; this rewraps each one, once,
 * into HMAC(IP_HASH_SECRET, oldHash), exactly what a new visit from that IP is
 * stored as, so unique visitors and the one-report-per-IP check carry on.
 * app_meta records the scheme (so it runs once) and a fingerprint of the secret: if
 * the secret changes later, stored hashes no longer match new ones, and startup says so.
 */
function migrateIpHashes(db, logger = console) {
  const ipHash = require('../services/ipHash');
  const tableExists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  const fingerprint = ipHash.fingerprint(); // throws before anything changes when the secret is missing

  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const getMeta = (key) => (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) || {}).value;
  const setMeta = db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (getMeta('ipHashScheme') === ipHash.SCHEME) {
    if (getMeta('ipHashKeyFingerprint') !== fingerprint) {
      logger.warn([
        '  ⚠️  IP_HASH_SECRET changed since the last start. Visits and reports from now on get',
        '     different IP hashes: unique-visitor counts and the one-report-per-IP check start over.',
        '     To undo, set the previous IP_HASH_SECRET again.'
      ].join('\n'));
      setMeta.run('ipHashKeyFingerprint', fingerprint);
    }
    return;
  }

  db.transaction(() => {
    db.function('linksnip_rewrap_ip_hash', { deterministic: true }, (hash) => ipHash.rewrapLegacy(hash));
    const targets = [['analytics_events', 'ipHash'], ['reports', 'reporterIpHash']];
    for (const [table, column] of targets) {
      if (!tableExists(table)) continue;
      const { changes } = db.prepare(`
        UPDATE ${table} SET ${column} = linksnip_rewrap_ip_hash(${column}) WHERE ${column} IS NOT NULL
      `).run();
      if (changes) logger.log(`  🔑 Keyed ${changes} IP hash(es) in ${table}...`);
    }
    setMeta.run('ipHashScheme', ipHash.SCHEME);
    setMeta.run('ipHashKeyFingerprint', fingerprint);
  })();
}

const TEAM_CONTENT_TABLES = ['urls', 'bundles', 'pastes', 'files', 'tags'];

/**
 * Teams: shared ownership of links, bundles, pastes and files (and per-team tags).
 * - teams, team_members (owner / admin / member / viewer), team_invites (pending, one per person and team)
 * - teamId on the content tables and tags: NULL is personal; deleting a team deletes its items (ON DELETE CASCADE,
 *   so the items' own delete triggers clean up analytics, tags and reports)
 * - a trigger keeps an owner: when the last one goes (left, removed, account deleted), the longest-standing admin,
 *   else member, else viewer becomes owner
 * Idempotent.
 */
function migrateTeams(db, logger = console) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const tableExists = (name) =>
    !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        createdBy INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (createdBy) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS team_members (
        teamId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
        joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (teamId, userId),
        FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_team_members_userId ON team_members(userId);
      CREATE TABLE IF NOT EXISTS team_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teamId INTEGER NOT NULL,
        userId INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
        invitedBy INTEGER,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (teamId, userId),
        FOREIGN KEY (teamId) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (invitedBy) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_team_invites_userId ON team_invites(userId);

      CREATE TRIGGER IF NOT EXISTS trg_team_members_keep_owner
      AFTER DELETE ON team_members
      WHEN OLD.role = 'owner'
        AND NOT EXISTS (SELECT 1 FROM team_members WHERE teamId = OLD.teamId AND role = 'owner')
      BEGIN
        UPDATE team_members SET role = 'owner'
        WHERE teamId = OLD.teamId AND userId = (
          SELECT userId FROM team_members WHERE teamId = OLD.teamId
          ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, joinedAt, rowid
          LIMIT 1
        );
      END;
    `);

    for (const table of TEAM_CONTENT_TABLES) {
      if (!tableExists(table)) continue;
      if (!columns(table).includes('teamId')) {
        logger.log(`  👥 Adding teamId to ${table}...`);
        db.exec(`ALTER TABLE ${table} ADD COLUMN teamId INTEGER REFERENCES teams(id) ON DELETE CASCADE`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_teamId ON ${table}(teamId)`);
    }
    if (tableExists('tags')) {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_team_name ON tags(teamId, name) WHERE teamId IS NOT NULL');
    }
  })();
}

/**
 * Files: userId becomes nullable with ON DELETE SET NULL (it was NOT NULL with ON DELETE CASCADE), like the other
 * content tables. Deleting an account then keeps the person's files in teams, without an owner. SQLite can't change
 * a column in place, so the table is rebuilt from its own CREATE statement; rows, indexes, triggers and the ID
 * sequence are kept.
 */
function migrateFileOwners(db, logger = console) {
  const info = db.prepare('PRAGMA table_info(files)').all();
  const userId = info.find(c => c.name === 'userId');
  if (!userId) return;
  const fk = db.prepare('PRAGMA foreign_key_list(files)').all().find(f => f.from === 'userId');
  if (!userId.notnull && (!fk || fk.on_delete === 'SET NULL')) return;

  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'files'").get();
  const rebuilt = sql
    .replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?["`]?files["`]?/i, 'CREATE TABLE files_rebuilt')
    .replace(/\buserId(\s+)INTEGER(\s+)NOT NULL/i, 'userId$1INTEGER')
    .replace(/FOREIGN KEY\s*\(userId\)\s*REFERENCES\s+users\s*\(id\)\s*ON DELETE CASCADE/i,
      'FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL');
  if (rebuilt === sql || !/ON DELETE SET NULL/.test(rebuilt)) {
    logger.log('  ⚠️  files.userId: unexpected table definition, left as it is');
    return;
  }

  logger.log('  📁 Files: keeping team files when their uploader\'s account is deleted...');
  const extras = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'files' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all();
  const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'files'").get();
  const columns = info.map(c => `"${c.name}"`).join(', ');

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(rebuilt);
      db.exec(`INSERT INTO files_rebuilt (${columns}) SELECT ${columns} FROM files`);
      db.exec('DROP TABLE files');
      db.exec('ALTER TABLE files_rebuilt RENAME TO files');
      for (const { sql: statement } of extras) db.exec(statement);
      if (sequence) db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'files'").run(sequence.seq);
      const broken = db.prepare('PRAGMA foreign_key_check(files)').all();
      if (broken.length) throw new Error(`files: ${broken.length} row(s) point at missing records`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

const SLUG_TABLES = ['urls', 'bundles', 'pastes', 'files'];

/**
 * Slugs ignore case (/s/Promo and /s/promo are one short link): a unique NOCASE index per content table.
 * Slugs that already differ only in case are named in a warning and that table keeps going without the index;
 * services/slugService.js refuses new look-alikes either way. The next start tries again.
 */
function migrateSlugCase(db, logger = console) {
  for (const table of SLUG_TABLES) {
    const index = `idx_${table}_slug_nocase`;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(index)) continue;
    const lookAlikes = db.prepare(`
      SELECT group_concat(slug, ', ') AS slugs FROM ${table} GROUP BY slug COLLATE NOCASE HAVING COUNT(*) > 1
    `).all();
    if (lookAlikes.length) {
      logger.warn(`  ⚠️  ${table}: slugs that differ only in case (${lookAlikes.map(r => r.slugs).join('; ')}). ` +
        'Rename all but one of each to make slugs case-insensitive in the database.');
      continue;
    }
    db.exec(`CREATE UNIQUE INDEX ${index} ON ${table}(slug COLLATE NOCASE)`);
  }
}

module.exports = {
  migrateUserRoles, migrateAnalyticsShareLinks, migrateQuarantine, migrateDropNotifications, migrateReports,
  migrateAnalytics, migrateTags, migrateIpHashes, migrateTeams, migrateFileOwners, migrateSlugCase
};
