const Database = require('better-sqlite3');
const { DB_PATH, ensureDataDir } = require('./paths');
const { configureDatabase } = require('./dbSetup');
const {
  migrateUserRoles, migrateAnalyticsShareLinks, migrateQuarantine, migrateDropNotifications, migrateReports,
  migrateAnalytics, migrateTags, migrateIpHashes, migrateTeams, migrateFileOwners, migrateSlugCase
} = require('./migrations');

// Initialize database (DATA_DIR must exist and be writable)
try {
  ensureDataDir();
} catch (error) {
  console.error(`\n❌ ${error.message}\n`);
  process.exit(1);
}
const db = new Database(DB_PATH, {
  verbose: process.env.NODE_ENV !== 'production' ? console.log : null
});

// WAL, busy timeout, foreign keys
configureDatabase(db);

console.log('🔄 Running database migrations...\n');

// ============================================================================
// CORE TABLES - Users and URLs
// ============================================================================

// Create Users table
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password TEXT NOT NULL,
    isAdmin INTEGER DEFAULT 0,
    isBanned INTEGER DEFAULT 0,
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
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creatorId) REFERENCES users(id) ON DELETE SET NULL
  )
`);

// ============================================================================
// COLUMN MIGRATIONS - Add missing columns to existing tables
// ============================================================================

// Users table migrations
const userColumns = db.prepare("PRAGMA table_info(users)").all();
const userColumnNames = userColumns.map(col => col.name);

if (!userColumnNames.includes('email')) {
  console.log('  📝 Adding email column to users...');
  db.exec('ALTER TABLE users ADD COLUMN email TEXT');
}

if (!userColumnNames.includes('lastActive')) {
  console.log('  📝 Adding lastActive column to users...');
  db.exec('ALTER TABLE users ADD COLUMN lastActive DATETIME');
}

if (!userColumnNames.includes('isBanned')) {
  console.log('  📝 Adding isBanned column to users...');
  db.exec('ALTER TABLE users ADD COLUMN isBanned INTEGER DEFAULT 0');
}

// Roles replace tiers: users.role, pro/enterprise → trusted (legacy tier column is no longer read)
migrateUserRoles(db);

// URLs table migrations
const urlColumns = db.prepare("PRAGMA table_info(urls)").all();
const urlColumnNames = urlColumns.map(col => col.name);

if (!urlColumnNames.includes('isBlocked')) {
  console.log('  📝 Adding isBlocked column to urls...');
  db.exec('ALTER TABLE urls ADD COLUMN isBlocked INTEGER DEFAULT 0');
}

if (!urlColumnNames.includes('password')) {
  console.log('  🔒 Adding password column to urls...');
  db.exec('ALTER TABLE urls ADD COLUMN password TEXT DEFAULT NULL');
}

if (!urlColumnNames.includes('activateAt')) {
  console.log('  ⏰ Adding activateAt column to urls...');
  db.exec('ALTER TABLE urls ADD COLUMN activateAt DATETIME DEFAULT NULL');
}

if (!urlColumnNames.includes('deactivateAt')) {
  console.log('  ⏰ Adding deactivateAt column to urls...');
  db.exec('ALTER TABLE urls ADD COLUMN deactivateAt DATETIME DEFAULT NULL');
}

// ============================================================================
// ANALYTICS TABLE
// ============================================================================

// One analytics_events table for every content type: created (and the old per-type
// analytics tables moved into it) by migrateAnalytics, after all content tables exist.

// ============================================================================
// TAGS SYSTEM
// ============================================================================

// One taggables table for every content type (and tags, unique per user): created (and the
// old url_tags / paste_tags / file_tags moved into it) by migrateTags, after all content tables exist.

// ============================================================================
// REPORTING SYSTEM
// ============================================================================

// One reports table for every content type: created (and the old url_reports /
// bundle_reports moved into it) by migrateReports, after all content tables exist.

// ============================================================================
// AUDIT LOGS SYSTEM
// ============================================================================

const auditLogsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();

if (!auditLogsExists) {
  console.log('  📋 Creating audit_logs table...');
  db.exec(`
    CREATE TABLE audit_logs (
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
}

// ============================================================================
// ANALYTICS SHARE LINKS (replaces the old user-to-user shares)
// ============================================================================

migrateAnalyticsShareLinks(db);

// ============================================================================
// NOTIFICATIONS (removed; table dropped)
// ============================================================================

migrateDropNotifications(db);

// ============================================================================
// BIO PAGES SYSTEM
// ============================================================================

const bioPagesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bio_pages'").get();

if (!bioPagesExists) {
  console.log('  👤 Creating bio_pages table...');
  db.exec(`
    CREATE TABLE bio_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER UNIQUE NOT NULL,
      displayName TEXT NOT NULL,
      bio TEXT,
      theme TEXT DEFAULT 'dark',
      socialLinks TEXT,
      gradientStart TEXT DEFAULT '#667eea',
      gradientEnd TEXT DEFAULT '#764ba2',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

// Add gradient color columns if missing (tables from before they existed)
{
  const columns = db.prepare("PRAGMA table_info(bio_pages)").all();
  const columnNames = columns.map(col => col.name);

  if (!columnNames.includes('gradientStart')) {
    console.log('  🎨 Adding gradientStart column to bio_pages...');
    db.exec("ALTER TABLE bio_pages ADD COLUMN gradientStart TEXT DEFAULT '#667eea'");
  }

  if (!columnNames.includes('gradientEnd')) {
    console.log('  🎨 Adding gradientEnd column to bio_pages...');
    db.exec("ALTER TABLE bio_pages ADD COLUMN gradientEnd TEXT DEFAULT '#764ba2'");
  }
}

const bioPageUrlsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bio_page_urls'").get();

if (!bioPageUrlsExists) {
  console.log('  🔗 Creating bio_page_urls junction table...');
  db.exec(`
    CREATE TABLE bio_page_urls (
      bioPageId INTEGER NOT NULL,
      urlId INTEGER NOT NULL,
      position INTEGER DEFAULT 0,
      label TEXT DEFAULT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (bioPageId, urlId),
      FOREIGN KEY (bioPageId) REFERENCES bio_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (urlId) REFERENCES urls(id) ON DELETE CASCADE
    )
  `);
}

// A label per link on a bio page (tables from before it existed)
if (!db.prepare('PRAGMA table_info(bio_page_urls)').all().some(col => col.name === 'label')) {
  console.log('  🔗 Adding label column to bio_page_urls...');
  db.exec('ALTER TABLE bio_page_urls ADD COLUMN label TEXT DEFAULT NULL');
}

// ============================================================================
// BUNDLES SYSTEM
// ============================================================================

const bundlesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bundles'").get();

if (!bundlesExists) {
  console.log('  📦 Creating bundles table...');
  db.exec(`
    CREATE TABLE bundles (
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
}

const bundleItemsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bundle_items'").get();

if (!bundleItemsExists) {
  console.log('  🔗 Creating bundle_items table...');
  db.exec(`
    CREATE TABLE bundle_items (
      id        INTEGER  PRIMARY KEY AUTOINCREMENT,
      bundleId  INTEGER  NOT NULL,
      url       TEXT     NOT NULL,
      label     TEXT     DEFAULT NULL,
      position  INTEGER  DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bundleId) REFERENCES bundles(id) ON DELETE CASCADE
    )
  `);
}

// ============================================================================
// FILES SYSTEM
// ============================================================================

const filesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get();

if (!filesExists) {
  console.log('  📁 Creating files table...');
  db.exec(`
    CREATE TABLE files (
      id           INTEGER  PRIMARY KEY AUTOINCREMENT,
      userId       INTEGER,
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
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
}

// Column migrations for files table (handles existing databases created before these columns existed)
const fileColumnNames = db.prepare("PRAGMA table_info(files)").all().map(c => c.name);

if (!fileColumnNames.includes('activateAt')) {
  console.log('  ⏰ Adding activateAt column to files...');
  db.exec('ALTER TABLE files ADD COLUMN activateAt DATETIME DEFAULT NULL');
}
if (!fileColumnNames.includes('deactivateAt')) {
  console.log('  ⏰ Adding deactivateAt column to files...');
  db.exec('ALTER TABLE files ADD COLUMN deactivateAt DATETIME DEFAULT NULL');
}
if (!fileColumnNames.includes('sharingMode')) {
  console.log('  🔒 Adding sharingMode column to files...');
  db.exec("ALTER TABLE files ADD COLUMN sharingMode TEXT DEFAULT 'public'");
}
if (!fileColumnNames.includes('allowedUsers')) {
  console.log('  👥 Adding allowedUsers column to files...');
  db.exec("ALTER TABLE files ADD COLUMN allowedUsers TEXT DEFAULT '[]'");
}
if (!fileColumnNames.includes('isBlocked')) {
  console.log('  🚫 Adding isBlocked column to files...');
  db.exec('ALTER TABLE files ADD COLUMN isBlocked INTEGER DEFAULT 0');
}

// ============================================================================
// PASTES SYSTEM
// ============================================================================

const pastesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pastes'").get();

if (!pastesExists) {
  console.log('  📝 Creating pastes table...');
  db.exec(`
    CREATE TABLE pastes (
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
}

// ============================================================================
// INDEXES - Create all performance indexes
// ============================================================================

console.log('  ⚡ Creating indexes...');

// Core indexes (always exist)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_slug ON urls(slug);
  CREATE INDEX IF NOT EXISTS idx_creatorId ON urls(creatorId);
  CREATE INDEX IF NOT EXISTS idx_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_email ON users(email);
`);

// Audit logs indexes (if table exists)
const auditLogsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
if (auditLogsTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_userId ON audit_logs(userId);
    CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_logs(category);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_audit_createdAt ON audit_logs(createdAt);
    CREATE INDEX IF NOT EXISTS idx_audit_targetType_targetId ON audit_logs(targetType, targetId);
  `);
}

// Analytics shares indexes (if table exists)

// Notifications indexes (if table exists)

// Bio pages indexes (if tables exist)
const bioPagesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bio_pages'").get();
const bioPageUrlsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bio_page_urls'").get();
if (bioPagesTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bio_pages_userId ON bio_pages(userId);
  `);
}
if (bioPageUrlsTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bio_page_urls_bioPageId ON bio_page_urls(bioPageId);
    CREATE INDEX IF NOT EXISTS idx_bio_page_urls_urlId ON bio_page_urls(urlId);
    CREATE INDEX IF NOT EXISTS idx_bio_page_urls_position ON bio_page_urls(bioPageId, position);
  `);
}

// Bundles indexes (if tables exist)
const bundlesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bundles'").get();
const bundleItemsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bundle_items'").get();
if (bundlesTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bundles_slug ON bundles(slug);
    CREATE INDEX IF NOT EXISTS idx_bundles_creatorId ON bundles(creatorId);
  `);
}
if (bundleItemsTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_bundle_items_bundleId ON bundle_items(bundleId);
    CREATE INDEX IF NOT EXISTS idx_bundle_items_position ON bundle_items(bundleId, position);
  `);
}

// ============================================================================
// REPORTS AND QUARANTINE (reports quarantine an item instead of blocking it)
// ============================================================================

migrateQuarantine(db);
migrateReports(db);

// Files indexes (if tables exist)
const filesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get();
if (filesTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_slug ON files(slug);
    CREATE INDEX IF NOT EXISTS idx_files_userId ON files(userId);
    CREATE INDEX IF NOT EXISTS idx_files_expiresAt ON files(expiresAt);
  `);
}

// Pastes indexes (if tables exist)
const pastesTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pastes'").get();
if (pastesTableExists) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pastes_slug ON pastes(slug);
    CREATE INDEX IF NOT EXISTS idx_pastes_userId ON pastes(userId);
    CREATE INDEX IF NOT EXISTS idx_pastes_expiresAt ON pastes(expiresAt);
  `);
}

// ============================================================================
// ANALYTICS (one events table for every type; share links by type + item)
// ============================================================================

migrateAnalytics(db);

// ============================================================================
// TAGS (one taggables table for every type; names unique per user)
// ============================================================================

migrateTags(db);

// ============================================================================
// KEYED IP HASHES (analytics and reports; needs IP_HASH_SECRET)
// ============================================================================

migrateIpHashes(db);

// ============================================================================
// TEAMS (shared items; teamId on content tables and tags)
// ============================================================================

migrateTeams(db);

// Files keep their place in a team when the uploader's account is deleted (userId nullable, ON DELETE SET NULL)
migrateFileOwners(db);

// Slugs ignore case: a unique NOCASE index per content table
migrateSlugCase(db);

console.log('\n✅ Database initialized and migrations completed successfully\n');

module.exports = db;
