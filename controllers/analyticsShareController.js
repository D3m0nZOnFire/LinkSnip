const AnalyticsShare = require('../models/AnalyticsShare');
const RoleService = require('../services/roleService');
const { logAccountChange, logAdminAction, ACTIONS } = require('../services/auditService');
const { findItem, pageData } = require('./analyticsController');
const { canEdit } = require('../services/itemPermissions');

/**
 * Analytics share links for any content type: the owner (or an admin) creates a
 * read-only, revocable /stats/<token> link, optionally expiring. Anyone with the link
 * sees the stats.
 */

const MAX_LABEL = 100;
const MAX_DAYS = 3650;

const canManage = (user, found) => canEdit(user, found.type, found.item);
const pathOf = (found) => `${found.info.publicPrefix}${found.item.slug}`;

/**
 * POST /api/share-links/:type/:id  { label?, expiresInDays? }
 */
exports.createLink = (req, res) => {
  const { type } = req.params;
  const found = findItem(type, req.params.id);
  if (!found) return res.status(404).json({ success: false, error: 'Not found' });
  if (!canManage(req.user, found)) return res.status(403).json({ success: false, error: 'Access denied' });

  const label = req.body.label ? String(req.body.label).trim() : null;
  if (label && label.length > MAX_LABEL) {
    return res.status(400).json({ success: false, error: `Label must be ${MAX_LABEL} characters or less` });
  }

  let expiresAt = null;
  const days = req.body.expiresInDays;
  if (days !== undefined && days !== null && days !== '') {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
      return res.status(400).json({ success: false, error: `Expiry must be a whole number of days from 1 to ${MAX_DAYS}` });
    }
    expiresAt = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
  }

  const limit = RoleService.limit(req.user, 'shareLinksPerUrl');
  if (limit !== null && AnalyticsShare.countActive(type, found.item.id) >= limit) {
    return res.status(403).json({
      success: false,
      error: `This ${found.info.noun} already has the maximum of ${limit} share links. Revoke one to create another.`
    });
  }

  const { token, link } = AnalyticsShare.create({ targetType: type, targetId: found.item.id, createdBy: req.user.id, label, expiresAt });
  logAccountChange(ACTIONS.CREATE_SHARE_LINK, req, {
    targetType: type, targetId: found.item.id, path: pathOf(found), shareLinkId: link.id, label, expiresAt
  });

  res.status(201).json({
    success: true,
    link,
    // The only time the token is ever shown
    shareUrl: `${req.protocol}://${req.get('host')}/stats/${token}`
  });
};

/**
 * GET /api/share-links/:type/:id
 */
exports.listLinks = (req, res) => {
  const found = findItem(req.params.type, req.params.id);
  if (!found) return res.status(404).json({ success: false, error: 'Not found' });
  if (!canManage(req.user, found)) return res.status(403).json({ success: false, error: 'Access denied' });

  const limit = RoleService.limit(req.user, 'shareLinksPerUrl');
  res.json({ success: true, links: AnalyticsShare.findActive(req.params.type, found.item.id), limit });
};

/**
 * DELETE /api/share-links/:id  (owner of the item, or admin)
 */
exports.revokeLink = (req, res) => {
  const link = AnalyticsShare.findById(parseInt(req.params.id));
  if (!link) return res.status(404).json({ success: false, error: 'Share link not found' });

  const found = findItem(link.targetType, link.targetId);
  if (!found || !canManage(req.user, found)) return res.status(403).json({ success: false, error: 'Access denied' });

  AnalyticsShare.revoke(link.id);
  const details = { targetType: link.targetType, targetId: link.targetId, path: pathOf(found), shareLinkId: link.id, label: link.label };
  if (req.user.isAdmin && found.item[found.info.ownerColumn] !== req.user.id) {
    logAdminAction(ACTIONS.REVOKE_SHARE_LINK, req, 'share_link', link.id, `/stats link for ${pathOf(found)}`, details);
  } else {
    logAccountChange(ACTIONS.REVOKE_SHARE_LINK, req, details);
  }
  res.json({ success: true });
};

/**
 * GET /stats/:token  (public, read-only)
 */
exports.viewStats = (req, res) => {
  const link = AnalyticsShare.findByToken(req.params.token);
  const found = link && findItem(link.targetType, link.targetId);
  if (!found) {
    return res.status(404).render('error', {
      title: 'Link Not Found',
      message: 'This analytics link does not exist, has expired or was revoked.',
      code: 404
    });
  }

  AnalyticsShare.recordView(link.id);
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.render('analytics', pageData(req, link.targetType, found, true));
};

/**
 * GET /admin/analytics-shares
 */
exports.getAdminPage = (req, res) => {
  const limit = 50;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const total = AnalyticsShare.countAll();

  res.render('admin-analytics-shares', {
    user: req.user,
    links: AnalyticsShare.findAll({ limit, offset: (page - 1) * limit }),
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    total
  });
};

/** Old link-only address /api/urls/:id/share-links (POST and GET): permanent, method-keeping redirect. */
exports.redirectOld = (req, res) => res.redirect(308, `/api/share-links/url/${encodeURIComponent(req.params.id)}`);
