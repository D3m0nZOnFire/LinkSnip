// The Express app (middleware, routers, error pages), built by createApp(); app.js loads config and listens.
const express = require('express');
const session = require('express-session');
const path = require('path');
const { parseTrustProxy } = require('./config/env');

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
const legalRoutes = require('./routes/legalRoutes');
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
const { securityHeaders } = require('./middleware/securityHeaders');
const requireLogin = require('./middleware/requireLogin');
const { sessionOptions } = require('./config/session');

/**
 * Builds the Express app: every middleware in order, the routers, the 404 and error handlers. Nothing listens,
 * loads config or schedules here (app.js does that), so tests can run the real app with supertest.
 *
 * @param {{ sessionSecret: string, sessionStore?: object }} options  no store: express-session's memory store
 * @returns {import('express').Express}
 */
function createApp({ sessionSecret, sessionStore } = {}) {
  if (!sessionSecret) throw new Error('createApp needs sessionSecret');

  const app = express();
  app.disable('x-powered-by');

  // Trust proxy: number of reverse proxies in front (TRUST_PROXY, default 1)
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

  // Content-Security-Policy, framing, referrer and sniffing headers on every response (middleware/securityHeaders.js)
  app.use(securityHeaders);

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
  app.use(session(sessionOptions({ store: sessionStore, secret: sessionSecret })));

  // Until the first admin exists, everything redirects to /setup (static files are served above)
  app.use(requireSetupComplete);
  app.use('/', setupRoutes);

  // Attach user to all requests
  app.use(attachUser);
  // Private instance (access.loginRequired): visitors reach only login, register and setup
  app.use(requireLogin);
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
  app.use('/', legalRoutes); // /privacy and /terms, from the live settings
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
  app.use('/', featureRoutes('analytics', analyticsRoutes)); // analytics pages (share links need it too: schema `requires`)
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

  return app;
}

module.exports = { createApp };
