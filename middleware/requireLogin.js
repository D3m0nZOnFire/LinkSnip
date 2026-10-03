const configService = require('../services/configService');

/**
 * A private instance (settings.json `access.loginRequired`): visitors without an account reach only what logging
 * in needs. Everything else, short links, pastes, files, bundles, info pages, QR codes, bio pages and /stats share
 * links included, sends them to log in first, and back afterwards (?next=; the home page and sent forms go to the
 * plain login page). API requests get 401.
 *
 * Mounted right after attachUser. The health check, static files, Chart.js and branding (theme, logo, favicon) are
 * served before it, so the login page keeps its look.
 */
const OPEN_PATHS = new Set(['/login', '/register', '/setup', '/logout']);

module.exports = function requireLogin(req, res, next) {
  if (req.user || OPEN_PATHS.has(req.path) || !configService.get('access.loginRequired')) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'login_required', message: 'Log in to use this instance.' });
  }
  if ((req.method !== 'GET' && req.method !== 'HEAD') || req.originalUrl === '/') return res.redirect('/login');
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
};
