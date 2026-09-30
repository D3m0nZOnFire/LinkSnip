const Bundle = require('../models/Bundle');
const AnalyticsService = require('../services/analyticsService');
const { checkAccess, sendAccessDenied } = require('../services/accessService');

/**
 * GET /bt/:itemId
 * Per-item tracking redirect: records click then redirects to destination URL
 */
async function trackBundleItemClick(req, res) {
  const itemId = parseInt(req.params.itemId);
  const db = require('../config/database');

  const item = db.prepare('SELECT * FROM bundle_items WHERE id = ?').get(itemId);
  const bundle = item && Bundle.findById(item.bundleId);

  if (!item || !bundle) {
    return res.status(404).render('error', {
      message: 'Link Not Found',
      error: { status: 404, stack: '' }
    });
  }

  // Item IDs are guessable: open nothing the bundle's own page would refuse. The usage
  // limit counts launches, so the visitor who launched the bundle can still open its items.
  const access = checkAccess(req, 'bundle', bundle);
  const launchedHere = (req.session.launchedBundles || []).includes(bundle.id);
  if (!access.allowed && !(access.status === 'limit_reached' && launchedHere)) {
    return sendAccessDenied(req, res, 'bundle', bundle, access);
  }

  // Record the item click as a sub-item event of its bundle (non-blocking)
  AnalyticsService.record(req, 'bundle', bundle.id, item.id).catch(() => { /* non-critical */ });

  return res.redirect(item.url);
}

module.exports = {
  trackBundleItemClick
};
