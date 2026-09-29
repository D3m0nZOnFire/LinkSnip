const setupService = require('../services/setupService');

/**
 * Until the first admin exists, every page redirects to /setup and API calls get 503.
 * Static files are served before this middleware, so the setup page keeps its styles.
 */
module.exports = function requireSetupComplete(req, res, next) {
  if (req.path === '/setup' || req.path === '/healthz' || !setupService.needsSetup()) return next();

  if (req.accepts('html')) return res.redirect('/setup');
  return res.status(503).json({ error: 'setup_required', message: 'Finish setup at /setup first.' });
};
