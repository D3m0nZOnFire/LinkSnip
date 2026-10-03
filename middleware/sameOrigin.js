/**
 * Cross-site request protection (CSRF): a request that changes something (POST, PUT, PATCH, DELETE) must come from
 * a page on this site. Browsers say where a request comes from, and a page on another site can't change that:
 *
 * 1. `Sec-Fetch-Site` (every current browser, over HTTPS and on localhost): `same-origin` or `none` (typed or
 *    bookmarked) passes, anything else (`cross-site`, `same-site`) is refused. It's trusted over `Origin`, so a proxy
 *    that rewrites the Host header doesn't break the site.
 * 2. Without it (older browsers, plain http): `Origin` must name this host (`Host` header, port included).
 * 3. Neither header: not a browser (curl, scripts), which can't carry a visitor's cookie by accident. Passes.
 *
 * GET, HEAD and OPTIONS never change anything, so they are not checked.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null; // "null" (sandboxed frame, data: page) or garbage
  }
}

function isSameOrigin(req) {
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';

  const origin = req.get('origin');
  if (!origin) return true;
  return originHost(origin) === req.get('host');
}

module.exports = function sameOrigin(req, res, next) {
  if (SAFE_METHODS.has(req.method) || isSameOrigin(req)) return next();

  const message = 'This request came from another site, so it was refused. Reload the page and try again.';
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'cross_site_request', message });
  }
  return res.status(403).render('error', { title: 'Request Refused', message, code: 403 });
};
