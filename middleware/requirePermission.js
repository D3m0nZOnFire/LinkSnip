const RoleService = require('../services/roleService');
const { PERMISSIONS } = require('../config/schema');

/**
 * Only let the request through when the user's role (or the anonymous role) has
 * the permission. Admins always pass.
 *
 * Denied without an account → /login (pages) or 401 JSON (/api/ and non-HTML requests).
 * Denied with an account    → / (pages) or 403 JSON.
 *
 * @param {string} permission - A key of PERMISSIONS in config/schema.js
 */
module.exports = function requirePermission(permission) {
  if (!(permission in PERMISSIONS)) throw new Error(`Unknown permission: ${permission}`);

  return function (req, res, next) {
    if (RoleService.can(req.user || null, permission)) return next();

    // /api/ calls always get JSON: fetch() sends Accept: */*, which would otherwise look like a page load
    const isApi = String(req.originalUrl || '').startsWith('/api/');
    const wantsHtml = !isApi && req.accepts('html');
    if (!req.session || !req.session.userId) {
      if (wantsHtml) return res.redirect('/login');
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (wantsHtml) return res.redirect('/');
    return res.status(403).json({
      error: 'permission_denied',
      permission,
      message: 'Your account is not allowed to do this.'
    });
  };
};
