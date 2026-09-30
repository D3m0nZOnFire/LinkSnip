const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const RoleService = require('../services/roleService');

/**
 * Rate Limiting Configuration for LinkSnip
 *
 * Security Feature: Prevents abuse and DDoS attacks by limiting requests per IP/user
 *
 * - Creation limits (links, pastes, bundles, imports, uploads) come from the user's role
 *   in roles.json and are read on every request, so role edits apply without a restart.
 *   null means unlimited; admins are never limited.
 * - Infrastructure limits (redirect, auth, API, unlock) are fixed.
 */

const HOUR = 60 * 60 * 1000;

/**
 * Hourly limiter whose limit is the named role limit.
 * Logged-in users are counted per user ID (prevents IP-switching bypass), visitors per IP.
 *
 * @param {string} limitName - A key of LIMITS in config/schema.js, e.g. 'urlsPerHour'
 * @param {{ prefix: string, noun: string }} opts - Key prefix and the plural noun used in the 429 message
 */
function createRoleLimiter(limitName, { prefix, noun }) {
  const currentLimit = (req) => RoleService.limit(req.user || null, limitName);

  return rateLimit({
    windowMs: HOUR,
    limit: (req) => currentLimit(req),
    skip: (req) => currentLimit(req) === null,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { limit: false }, // 0 is intentional: "none allowed"
    keyGenerator: (req) => (req.user && req.user.id)
      ? `${prefix}_user_${req.user.id}`
      : `${prefix}_ip_${ipKeyGenerator(req.ip)}`,
    handler: (req, res) => {
      const { limit, resetTime } = req.rateLimit;
      res.status(429).json({
        error: limit === 0
          ? `Your account is not allowed to create ${noun}.`
          : `Rate limit reached: ${limit} ${noun} per hour. Please try again later.`,
        retryAfter: resetTime ? Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : null
      });
    }
  });
}

const createUrlLimiter = createRoleLimiter('urlsPerHour', { prefix: 'url', noun: 'links' });
const createPasteLimiter = createRoleLimiter('pastesPerHour', { prefix: 'paste', noun: 'pastes' });
const createBundleLimiter = createRoleLimiter('bundlesPerHour', { prefix: 'bundle', noun: 'bundles' });
const bulkImportLimiter = createRoleLimiter('importsPerHour', { prefix: 'bulk_import', noun: 'imports' });
const uploadLimiter = createRoleLimiter('uploadsPerHour', { prefix: 'upload', noun: 'uploads' });

// Rate limiter for redirect endpoint (prevent DDoS)
const redirectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes per IP
  message: {
    error: 'Too many redirect requests from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('error', {
      message: 'Too Many Requests',
      error: {
        status: 429,
        stack: 'You have made too many requests. Please try again in a few minutes.'
      }
    });
  }
});

// Rate limiter for API endpoints (general protection)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 minutes
  message: {
    error: 'Too many requests from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip for admins
    return req.session && req.session.isAdmin;
  }
});

// Rate limiter for authentication endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 minutes
  message: {
    error: 'Too many login attempts from this IP. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many login attempts from this IP. Please try again in 15 minutes.',
      retryAfter: Math.ceil(req.rateLimit.resetTime / 1000)
    });
  }
});

/**
 * Password unlock attempts on /unlock/:type/:slug (brute-force protection), separate
 * from the login limiter. Only failed attempts count (a wrong password answers 401):
 * `perItem` per visitor and item, and `perVisitor` across all items. A blocked
 * attempt gets the unlock page with an error (unlockController.lockedOut).
 * @returns {Function[]} middleware, per-item limiter first
 */
function createUnlockLimiter({ perItem = 10, perVisitor = 30, windowMs = 15 * 60 * 1000 } = {}) {
  const shared = {
    windowMs,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (req, res) => require('../controllers/unlockController').lockedOut(req, res)
  };
  const visitor = (req) => `unlock_${ipKeyGenerator(req.ip)}`;
  return [
    rateLimit({ ...shared, limit: perItem, keyGenerator: (req) => `${visitor(req)}_${req.params.type}_${req.params.slug}` }),
    rateLimit({ ...shared, limit: perVisitor, keyGenerator: visitor })
  ];
}

module.exports = {
  createRoleLimiter,
  createUrlLimiter,
  redirectLimiter,
  apiLimiter,
  authLimiter,
  bulkImportLimiter,
  createUnlockLimiter,
  createBundleLimiter,
  createPasteLimiter,
  uploadLimiter
};
