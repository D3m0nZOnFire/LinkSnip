const bcrypt = require('bcrypt');
const db = require('../config/database');
const configService = require('../services/configService');
const unlocks = require('../services/unlockService');
const { sendIfUnavailable } = require('../services/accessService');
const { CONTENT_TYPES } = require('../services/contentTypes');
const { logSecurity, ACTIONS } = require('../services/auditService');

/**
 * One password page for every content type: /unlock/:type/:slug.
 * A wrong password answers 401 so the unlock limiter counts it (only failures count).
 */

/** The record behind /unlock/:type/:slug, or null (unknown type, feature off, no such slug). */
function findRecord(type, slug) {
  const info = CONTENT_TYPES[type];
  if (!info) return null;
  if (info.feature && !configService.get(`features.${info.feature}`)) return null;
  const record = db.prepare(`SELECT * FROM ${info.table} WHERE slug = ?`).get(slug);
  return record ? { info, record } : null;
}

/** What the visitor is unlocking, as shown on the page. */
function labelOf(req, type, record) {
  switch (type) {
    case 'url': return `${req.protocol}://${req.get('host')}/s/${record.slug}`;
    case 'bundle': return record.title;
    case 'paste': return record.title || record.slug;
    case 'file': return record.originalName;
    default: return record.slug;
  }
}

function renderPage(req, res, type, found, error, status = 200) {
  const { info, record } = found;
  return res.status(status).render('unlock', {
    user: req.user || null,
    type,
    noun: info.noun,
    slug: record.slug,
    label: labelOf(req, type, record),
    canRemember: !info.alwaysRemember,
    infoUrl: info.infoPrefix ? `${info.infoPrefix}${record.slug}` : null,
    error
  });
}

const notFound = (res) => res.status(404).render('error', { title: 'Not Found', message: 'This page does not exist.', code: 404 });

/**
 * GET /unlock/:type/:slug
 */
exports.showUnlockPage = (req, res) => {
  const { type, slug } = req.params;
  const found = findRecord(type, slug);
  if (!found) return notFound(res);

  if (sendIfUnavailable(req, res, type, found.record)) return;
  if (!found.record.password) return res.redirect(`${found.info.publicPrefix}${slug}`);

  return renderPage(req, res, type, found, null);
};

/**
 * POST /unlock/:type/:slug  { password, remember }
 */
exports.unlock = async (req, res) => {
  const { type, slug } = req.params;
  const found = findRecord(type, slug);
  if (!found) return notFound(res);

  const { info, record } = found;
  if (sendIfUnavailable(req, res, type, record)) return;
  if (!record.password) return res.redirect(`${info.publicPrefix}${slug}`);

  const { password, remember } = req.body || {};
  // Passwords are stored trimmed; links stored them as typed before, so try that first
  const typed = String(password || '');
  const correct = await bcrypt.compare(typed, record.password) ||
    (typed.trim() !== typed && await bcrypt.compare(typed.trim(), record.password));
  if (!correct) return renderPage(req, res, type, found, 'Incorrect password. Please try again.', 401);

  unlocks.grant(req.session, type, record.id, remember === '1');
  return res.redirect(`${info.publicPrefix}${slug}`);
};

/**
 * 429 from the unlock limiter: the unlock page with an error. The first blocked
 * attempt of a lockout is audit-logged.
 */
exports.lockedOut = (req, res) => {
  const { type, slug } = req.params;
  const found = findRecord(type, slug);
  const path = found ? `${found.info.publicPrefix}${slug}` : `/unlock/${type}/${slug}`;

  if (req.rateLimit && req.rateLimit.used === req.rateLimit.limit + 1) {
    logSecurity(ACTIONS.UNLOCK_LOCKOUT, req, type, found ? found.record.id : null, path, {
      limit: req.rateLimit.limit
    });
  }

  const error = 'Too many password attempts. Please try again in 15 minutes.';
  if (!found) return res.status(429).render('error', { title: 'Too Many Attempts', message: error, code: 429 });
  return renderPage(req, res, type, found, error, 429);
};

/** Old per-type addresses (/unlock/:slug, /unlock-paste/:slug, …): permanent, method-keeping redirect. */
exports.redirectOld = (type) => (req, res) => res.redirect(308, `/unlock/${type}/${encodeURIComponent(req.params.slug)}`);
