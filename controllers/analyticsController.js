const db = require('../config/database');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const { CONTENT_TYPES, isTypeEnabled } = require('../services/contentTypes');

/**
 * Analytics pages for every content type: /analytics/:type/:id (owner or admin) and
 * the read-only /stats/:token share view use the same view data.
 */

/** The item behind :type/:id, or null (unknown type, feature off, no such item). */
function findItem(type, id) {
  if (!isTypeEnabled(type)) return null;
  const info = CONTENT_TYPES[type];
  const item = db.prepare(`SELECT * FROM ${info.table} WHERE id = ?`).get(parseInt(id));
  return item ? { info, item } : null;
}

// Analytics are private to the item's owner and admins; others use share links.
const canView = (user, info, item) => !!user && (user.isAdmin || item[info.ownerColumn] === user.id);

/** What the analytics page shows for one item (also used by /stats/:token). */
function pageData(req, type, found, readOnly) {
  const { info, item } = found;
  return {
    user: req.user || null,
    type,
    item,
    noun: info.noun,
    eventLabel: info.eventLabel,
    path: `${info.publicPrefix}${item.slug}`,
    infoUrl: info.infoPrefix ? `${info.infoPrefix}${item.slug}` : null,
    target: item[info.destination],
    summary: AnalyticsEvent.getSummary(type, item.id),
    itemClicks: type === 'bundle' ? AnalyticsEvent.getItemClicks(item.id) : null,
    baseUrl: `${req.protocol}://${req.get('host')}`,
    readOnly
  };
}

const notFound = (res) => res.status(404).render('error', { title: 'Not Found', message: 'This item does not exist.', code: 404 });

class AnalyticsController {
  /**
   * GET /analytics/:type/:id
   */
  static getAnalyticsPage(req, res) {
    const { type, id } = req.params;
    const found = findItem(type, id);
    if (!found) return notFound(res);
    if (!canView(req.user, found.info, found.item)) return res.redirect('/dashboard');

    res.render('analytics', pageData(req, type, found, false));
  }

  /**
   * GET /api/analytics/:type/:id[?days=N]
   */
  static getAnalyticsData(req, res) {
    const { type, id } = req.params;
    const found = findItem(type, id);
    if (!found) return res.status(404).json({ error: 'Not found' });
    if (!canView(req.user, found.info, found.item)) return res.status(403).json({ error: 'Access denied' });

    const summary = AnalyticsEvent.getSummary(type, found.item.id);
    const days = parseInt(req.query.days);
    if (days > 0) {
      const byDate = AnalyticsEvent.getByDate(type, found.item.id, days);
      Object.assign(summary, { byDate: byDate.data, byDatePeriod: byDate.period });
    }
    res.json({
      type,
      item: { id: found.item.id, slug: found.item.slug },
      summary,
      itemClicks: type === 'bundle' ? AnalyticsEvent.getItemClicks(found.item.id) : null
    });
  }

  /**
   * GET /api/analytics/top (admin)
   */
  static getTopUrls(req, res) {
    const { limit = 10, days = null } = req.query;
    res.json(AnalyticsEvent.getTopUrls(parseInt(limit), days ? parseInt(days) : null));
  }

  /**
   * GET /admin/analytics
   */
  static getAdminAnalyticsPage(req, res) {
    res.render('admin-analytics', {
      user: req.user,
      topUrls: AnalyticsEvent.getTopUrls(20, 30),
      totalClicks: AnalyticsEvent.countAll('url'),
      totalUrls: db.prepare('SELECT COUNT(*) AS n FROM urls').get().n,
      baseUrl: `${req.protocol}://${req.get('host')}`
    });
  }

  /** Old per-type addresses: /analytics/:id, /bundle-analytics/:id, /pastes/:id/analytics, … */
  static redirectOld(type, { api = false } = {}) {
    return (req, res) => res.redirect(api ? 308 : 301, `${api ? '/api' : ''}/analytics/${type}/${encodeURIComponent(req.params.id)}`);
  }
}

module.exports = AnalyticsController;
module.exports.findItem = findItem;
module.exports.pageData = pageData;
