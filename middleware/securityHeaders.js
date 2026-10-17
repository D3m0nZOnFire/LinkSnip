/**
 * Security headers for every response (mounted first in app.js).
 *
 * Content-Security-Policy: scripts only from this site (views have no inline script code; data goes in
 * <script type="application/json">), so an injected <script> or handler doesn't run. Styles allow 'unsafe-inline'
 * for the style attributes that carry CSS variables (tag colors, palette previews, the bio gradient).
 * No form-action: a password unlock posts here and is then redirected to the destination, which browsers check
 * against form-action too.
 *
 * A route can replace the policy with res.set() (file downloads and SVG branding are sandboxed).
 * HSTS is set by the HTTPS proxy (docker/Caddyfile), not here: LinkSnip can't tell that it is served over HTTPS only.
 */

const IONICONS = 'https://unpkg.com/ionicons@7.1.0/';
const DASHBOARD_ICONS_API = 'https://api.github.com/repos/homarr-labs/dashboard-icons/';
const DASHBOARD_ICONS = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/';

const BASE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'frame-ancestors': ["'none'"]
};

function policy(directives) {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

const BASE_POLICY = policy(BASE);

// The bio page and its settings load Ionicons (unpkg) and Dashboard Icons (jsDelivr; the settings page lists them
// through the GitHub API). Only those two pages get the extra sources.
const BIO_POLICY = policy({
  ...BASE,
  'script-src': [...BASE['script-src'], IONICONS],
  'connect-src': ["'self'", IONICONS, DASHBOARD_ICONS_API],
  'img-src': [...BASE['img-src'], DASHBOARD_ICONS]
});

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': BASE_POLICY,
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  next();
}

function allowBioIcons(req, res, next) {
  res.set('Content-Security-Policy', BIO_POLICY);
  next();
}

module.exports = { securityHeaders, allowBioIcons };
