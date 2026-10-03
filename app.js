require('dotenv').config({ quiet: true });

// Refuse to start without the secrets or a writable DATA_DIR (before writing anything)
const { requireSessionSecret, requireIpHashSecret, parseTrustProxy } = require('./config/env');
let SESSION_SECRET;
try {
  SESSION_SECRET = requireSessionSecret();
  requireIpHashSecret();
  require('./config/paths').ensureDataDir(); // settings.json is seeded before the database opens
} catch (error) {
  console.error(`\n❌ ${error.message}\n`);
  process.exit(1);
}

const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const path = require('path');

// Load DATA_DIR/settings.json and roles.json (created with defaults on first start),
// then poll them so hand edits apply without a restart.
const configService = require('./services/configService');
configService.load({ seed: true });
configService.watch();

// Initialize database (creates tables if they don't exist)
const db = require('./config/database');

// Initialize scheduled tasks
const ScheduledTasks = require('./services/scheduledTasks');

// Import routes
const setupRoutes = require('./routes/setupRoutes');
const authRoutes = require('./routes/authRoutes');
const urlRoutes = require('./routes/urlRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const adminItemRoutes = require('./routes/adminItemRoutes');
const tagRoutes = require('./routes/tagRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const analyticsShareRoutes = require('./routes/analyticsShareRoutes');
const qrcodeRoutes = require('./routes/qrcodeRoutes');
const infoRoutes = require('./routes/infoRoutes');
const reportRoutes = require('./routes/reportRoutes');
const importExportRoutes = require('./routes/importExportRoutes');
const teamRoutes = require('./routes/teamRoutes');
const unlockRoutes = require('./routes/unlockRoutes');
const bioPageRoutes = require('./routes/bioPageRoutes');
const bundleRoutes = require('./routes/bundleRoutes');
const fileRoutes = require('./routes/fileRoutes');
const pasteRoutes = require('./routes/pasteRoutes');
const UrlController = require('./controllers/urlController');

// Import middleware
const { attachUser } = require('./middleware/auth');
const requireSetupComplete = require('./middleware/requireSetupComplete');
const { createUrlLimiter, redirectLimiter, apiLimiter, authLimiter } = require('./middleware/rateLimiter');
const requirePermission = require('./middleware/requirePermission');
const { viewLocals, appLocals, brandingLocals } = require('./middleware/viewLocals');
const { prefillFromPath } = require('./middleware/prefill');
const { featureRoutes } = require('./middleware/requireFeature');
const sameOrigin = require('./middleware/sameOrigin');
const { sessionOptions } = require('./config/session');

const app = express();
const PORT = process.env.PORT || 8081;

// Trust proxy: number of reverse proxies in front (TRUST_PROXY, default 1)
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Health check first: no session, no setup redirect
app.use(require('./routes/healthRoutes'));

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(require('./routes/vendorRoutes')); // Chart.js from node_modules (no CDN)
// Palette CSS, logo and favicon (Admin → Appearance), and `branding` for every page, setup and errors included
app.use(require('./routes/brandingRoutes'));
app.use(brandingLocals);

// Changing requests (POST, PUT, PATCH, DELETE) from another site are refused (CSRF), before any session is read
app.use(sameOrigin);

// Session (config/session.js: SameSite=Lax cookie, 7 days)
app.use(session(sessionOptions({
  store: new SqliteStore({
    client: db,
    expired: {
      clear: true,
      intervalMs: 900000 // Clear expired sessions every 15 minutes
    }
  }),
  secret: SESSION_SECRET
})));

// Until the first admin exists, everything redirects to /setup (static files are served above)
app.use(requireSetupComplete);
app.use('/', setupRoutes);

// Attach user to all requests
app.use(attachUser);
// Views get `features.<name>`, `can.<permission>`, `registrationOpen` and `writableTeams` per request,
// and the app version and report reasons always (middleware/viewLocals.js)
app.use(viewLocals);
Object.assign(app.locals, appLocals());

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// lnksnp.ch/<a link> opens the create page with it filled in (before the routes)
app.use(prefillFromPath(UrlController.getCreateForm));

// Routes
app.use('/', authRoutes); // Auth routes have their own rate limiter applied in authRoutes.js
app.use('/', urlRoutes); // URL routes (redirect endpoint) have their own rate limiter
app.use('/', unlockRoutes); // Password unlock for every type: /unlock/:type/:slug
app.use('/', featureRoutes('bundles', bundleRoutes)); // Bundle routes
app.use('/', featureRoutes('files', fileRoutes));  // File hosting routes
app.use('/', featureRoutes('pastes', pasteRoutes)); // Pastebin routes (MUST come before bioPageRoutes/infoRoutes to avoid username catch-all conflicts)
app.use('/', featureRoutes('bioPages', bioPageRoutes)); // Bio page routes (MUST come before infoRoutes to avoid conflicts)
app.use('/', dashboardRoutes);
app.use('/', userRoutes);
app.use('/', adminRoutes);
app.use('/', adminItemRoutes); // block, unblock, delete for every type (a type's feature off: 404)
app.use('/', analyticsRoutes);
app.use('/', featureRoutes('analyticsShareLinks', analyticsShareRoutes));
app.use('/', featureRoutes('qrCodes', qrcodeRoutes));
app.use('/', tagRoutes);
app.use('/', infoRoutes);
app.use('/', featureRoutes('reports', reportRoutes));
app.use('/', featureRoutes('importExport', importExportRoutes));
app.use('/', featureRoutes('teams', teamRoutes)); // /teams, team API, /admin/teams

// Home page - URL creation form
app.get('/', UrlController.getCreateForm);
app.post('/create', requirePermission('createUrls'), createUrlLimiter, UrlController.createShortUrl); // Apply rate limiter to URL creation

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.',
    code: 404
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Server Error',
    message: 'An unexpected error occurred. Please try again later.',
    code: 500
  });
});

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
