/**
 * Links in the address: lnksnp.ch/https://example.com/page?x=1 (or /example.com/page) opens the create page with
 * that link filled in. Mounted before the routes; anything else passes through.
 */

const MAX_URL_LENGTH = 2048; // what browsers accept
// The first part of a link typed without https://: a host name like www.example.com
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}(:\d+)?$/i;
// File extensions that are no domain ending: /xmlrpc.php or /index.html is a file name (scanners probe them), not a host
const FILE_EXTENSION = /\.(php\d?|phtml|html?|aspx?|jsp|cgi|xml|json|txt|sql|ini|env|bak|log|ya?ml|cfg|conf)(:\d+)?$/i;

/**
 * @param {string} originalUrl - path and query string, e.g. "/https://www.youtube.com/watch?v=x&t=1s"
 * @returns {string|null} the link, or null when the path isn't one
 */
function urlFromPath(originalUrl) {
  let raw = String(originalUrl || '').slice(1);
  if (!raw) return null;
  if (/^https?%3A/i.test(raw)) {
    try { raw = decodeURIComponent(raw); } catch (_) { return null; }
  }

  let candidate;
  const scheme = /^(https?):\/*(.*)$/i.exec(raw);
  const host = raw.split(/[/?#]/)[0];
  if (scheme) {
    // Some proxies merge "//" in a path into "/": put it back
    candidate = `${scheme[1].toLowerCase()}://${scheme[2]}`;
  } else if (HOST.test(host) && !FILE_EXTENSION.test(host)) {
    candidate = `https://${raw}`;
  } else {
    return null;
  }
  if (candidate.length > MAX_URL_LENGTH || /\s/.test(candidate)) return null;

  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
  } catch (_) {
    return null;
  }
  return candidate;
}

/**
 * @param {Function} createPage - the handler of the create page (it reads req.prefillUrl)
 */
function prefillFromPath(createPage) {
  return (req, res, next) => {
    const url = urlFromPath(req.originalUrl);
    if (!url) return next();
    req.prefillUrl = url;
    return createPage(req, res);
  };
}

module.exports = { urlFromPath, prefillFromPath };
