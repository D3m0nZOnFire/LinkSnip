const Database = require('better-sqlite3');
const { migrateAnalyticsShareLinks, migrateQuarantine } = require('../../config/migrations');

let db = null;

/**
 * Create an in-memory SQLite database with full schema
 * @returns {Database} In-memory database instance
 */
function createTestDatabase() {
  // Create in-memory database
  db = new Database(':memory:');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      isAdmin INTEGER DEFAULT 0,
      isBanned INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'free',
      role TEXT DEFAULT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastActive DATETIME
    )
  `);

  // Create Urls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      longUrl TEXT NOT NULL,
      creatorId INTEGER DEFAULT NULL,
      clicks INTEGER DEFAULT 0,
      maxUses INTEGER DEFAULT NULL,
      expiresAt DATETIME DEFAULT NULL,
      isBlocked INTEGER DEFAULT 0,
      password TEXT DEFAULT NULL,
      activateAt DATETIME DEFAULT NULL,
      deactivateAt DATETIME DEFAULT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creatorId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create Analytics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      urlId INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT,
      referrer TEXT,
      userAgent TEXT,
      browser TEXT,
      os TEXT,
      device TEXT,
      country TEXT,
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE
    )
  `);

  // Create Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#34d399',
      userId INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create url_tags junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_tags (
      urlId INTEGER NOT NULL,
      tagId INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (urlId, tagId),
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    )
  `);

  // Create url_reports table
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_reports (
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
    )
  `);

  // Create audit_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      category TEXT NOT NULL,
      targetType TEXT,
      targetId INTEGER,
      targetDescription TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      details TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create bundles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundles (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      slug         TEXT     UNIQUE NOT NULL,
      title        TEXT     NOT NULL,
      description  TEXT     DEFAULT NULL,
      creatorId    INTEGER  DEFAULT NULL,
      clicks       INTEGER  DEFAULT 0,
      maxUses      INTEGER  DEFAULT NULL,
      expiresAt    DATETIME DEFAULT NULL,
      isBlocked    INTEGER  DEFAULT 0,
      password     TEXT     DEFAULT NULL,
      activateAt   DATETIME DEFAULT NULL,
      deactivateAt DATETIME DEFAULT NULL,
      createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creatorId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create bundle_items table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundle_items (
      id        INTEGER  PRIMARY KEY AUTOINCREMENT,
      bundleId  INTEGER  NOT NULL,
      url       TEXT     NOT NULL,
      label     TEXT     DEFAULT NULL,
      position  INTEGER  DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE
    )
  `);

  // Create bundle_analytics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundle_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundleId INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT,
      referrer TEXT,
      userAgent TEXT,
      browser TEXT,
      os TEXT,
      device TEXT,
      country TEXT,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE
    )
  `);

  // Create bundle_item_analytics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundle_item_analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bundleItemId INTEGER NOT NULL,
      bundleId INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash TEXT,
      FOREIGN KEY (bundleItemId) REFERENCES bundle_items(id) ON DELETE CASCADE,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE
    )
  `);

  // Create files table
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      userId       INTEGER  NOT NULL,
      slug         TEXT     UNIQUE NOT NULL,
      originalName TEXT     NOT NULL,
      storedName   TEXT     NOT NULL,
      mimeType     TEXT     NOT NULL,
      size         INTEGER  NOT NULL,
      expiresAt    DATETIME DEFAULT NULL,
      activateAt   DATETIME DEFAULT NULL,
      deactivateAt DATETIME DEFAULT NULL,
      maxDownloads INTEGER  DEFAULT NULL,
      downloads    INTEGER  DEFAULT 0,
      password     TEXT     DEFAULT NULL,
      sharingMode  TEXT     DEFAULT 'public',
      allowedUsers TEXT     DEFAULT '[]',
      isBlocked    INTEGER  DEFAULT 0,
      createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create file_tags junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_tags (
      fileId INTEGER NOT NULL,
      tagId  INTEGER NOT NULL,
      PRIMARY KEY (fileId, tagId),
      FOREIGN KEY (fileId) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId)  REFERENCES tags(id)  ON DELETE CASCADE
    )
  `);

  // Create pastes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pastes (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      userId       INTEGER  DEFAULT NULL,
      slug         TEXT     UNIQUE NOT NULL,
      title        TEXT     DEFAULT NULL,
      content      TEXT     NOT NULL,
      language     TEXT     DEFAULT NULL,
      expiresAt    DATETIME DEFAULT NULL,
      activateAt   DATETIME DEFAULT NULL,
      deactivateAt DATETIME DEFAULT NULL,
      maxViews     INTEGER  DEFAULT NULL,
      views        INTEGER  DEFAULT 0,
      password     TEXT     DEFAULT NULL,
      isBlocked    INTEGER  DEFAULT 0,
      createdAt    DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Create paste_tags junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS paste_tags (
      pasteId INTEGER NOT NULL,
      tagId   INTEGER NOT NULL,
      PRIMARY KEY (pasteId, tagId),
      FOREIGN KEY (pasteId) REFERENCES pastes(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId)   REFERENCES tags(id)   ON DELETE CASCADE
    )
  `);

  // Create paste_analytics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS paste_analytics (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      pasteId   INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      ipHash    TEXT,
      referrer  TEXT,
      userAgent TEXT,
      browser   TEXT,
      os        TEXT,
      device    TEXT,
      country   TEXT,
      FOREIGN KEY (pasteId) REFERENCES pastes(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_slug ON urls(slug);
    CREATE INDEX IF NOT EXISTS idx_creatorId ON urls(creatorId);
    CREATE INDEX IF NOT EXISTS idx_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_analytics_urlId ON analytics(urlId);
    CREATE INDEX IF NOT EXISTS idx_tags_userId ON tags(userId);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_url_tags_urlId ON url_tags(urlId);
    CREATE INDEX IF NOT EXISTS idx_url_tags_tagId ON url_tags(tagId);
    CREATE INDEX IF NOT EXISTS idx_reports_urlId ON url_reports(urlId);
    CREATE INDEX IF NOT EXISTS idx_reports_status ON url_reports(status);
    CREATE INDEX IF NOT EXISTS idx_pastes_slug ON pastes(slug);
    CREATE INDEX IF NOT EXISTS idx_pastes_userId ON pastes(userId);
    CREATE INDEX IF NOT EXISTS idx_pastes_expiresAt ON pastes(expiresAt);
    CREATE INDEX IF NOT EXISTS idx_paste_tags_pasteId ON paste_tags(pasteId);
    CREATE INDEX IF NOT EXISTS idx_paste_tags_tagId ON paste_tags(tagId);
    CREATE INDEX IF NOT EXISTS idx_paste_analytics_pasteId ON paste_analytics(pasteId);
    CREATE INDEX IF NOT EXISTS idx_paste_analytics_timestamp ON paste_analytics(timestamp);
  `);

  // bundle_reports (mirrors config/database.js)
  db.exec(`
    CREATE TABLE IF NOT EXISTS bundle_reports (
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
    )
  `);

  // Tables with a testable migration are created by that migration, not mirrored by hand
  migrateAnalyticsShareLinks(db, { log: () => {} });
  migrateQuarantine(db, { log: () => {} });

  return db;
}

/**
 * Get the current test database instance
 * @returns {Database} Database instance
 */
function getTestDatabase() {
  if (!db) {
    createTestDatabase();
  }
  return db;
}

/**
 * Clear all data from the test database (preserves schema)
 */
function clearTestDatabase() {
  if (!db) return;

  // Delete in order respecting foreign key constraints
  db.exec('DELETE FROM bundle_reports');
  db.exec('DELETE FROM bundle_item_analytics');
  db.exec('DELETE FROM bundle_analytics');
  db.exec('DELETE FROM bundle_items');
  db.exec('DELETE FROM bundles');
  db.exec('DELETE FROM paste_analytics');
  db.exec('DELETE FROM paste_tags');
  db.exec('DELETE FROM pastes');
  db.exec('DELETE FROM file_tags');
  db.exec('DELETE FROM files');
  db.exec('DELETE FROM analytics_shares');
  db.exec('DELETE FROM url_tags');
  db.exec('DELETE FROM url_reports');
  db.exec('DELETE FROM analytics');
  db.exec('DELETE FROM audit_logs');
  db.exec('DELETE FROM tags');
  db.exec('DELETE FROM urls');
  db.exec('DELETE FROM users');

  // Reset autoincrement counters
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users', 'urls', 'analytics', 'tags', 'url_reports', 'audit_logs', 'bundles', 'bundle_items', 'bundle_analytics', 'bundle_item_analytics', 'files', 'pastes', 'paste_analytics', 'analytics_shares', 'bundle_reports')");
}

/**
 * Close the test database connection
 */
function closeTestDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  createTestDatabase,
  getTestDatabase,
  clearTestDatabase,
  closeTestDatabase
};
