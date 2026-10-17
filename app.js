require('dotenv').config({ quiet: true });

// Refuse to start without the secrets or a writable DATA_DIR (before writing anything)
const { requireSessionSecret, requireIpHashSecret } = require('./config/env');
let SESSION_SECRET;
try {
  SESSION_SECRET = requireSessionSecret();
  requireIpHashSecret();
  require('./config/paths').ensureDataDir(); // settings.json is seeded before the database opens
} catch (error) {
  console.error(`\n❌ ${error.message}\n`);
  process.exit(1);
}

const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);

// Load DATA_DIR/settings.json and roles.json (created with defaults on first start),
// then poll them so hand edits apply without a restart.
const configService = require('./services/configService');
configService.load({ seed: true });
configService.watch();

// Initialize database (creates tables if they don't exist)
const db = require('./config/database');

// Initialize scheduled tasks
const ScheduledTasks = require('./services/scheduledTasks');

// The app itself: middleware, routes, error pages (createApp.js)
const { createApp } = require('./createApp');

const app = createApp({
  sessionSecret: SESSION_SECRET,
  sessionStore: new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 900000 // Clear expired sessions every 15 minutes
    }
  })
});
const PORT = process.env.PORT || 8081;

// Start server
app.listen(PORT, () => {
  console.log(`🚀 URL Shortener running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

  // Initialize scheduled tasks after server starts
  ScheduledTasks.init();
  ScheduledTasks.updateGeoDatabase(); // fetch the country database on first start (doesn't block)

  // No admin yet: print the one-time setup code (last, so it isn't buried in startup logs)
  require('./services/setupService').start();
});

module.exports = app;
