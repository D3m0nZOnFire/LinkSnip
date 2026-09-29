const Bundle = require('../models/Bundle');
const BundleAnalytics = require('../models/BundleAnalytics');
const BundleItemAnalytics = require('../models/BundleItemAnalytics');
const AnalyticsService = require('../services/analyticsService');
const QRCodeService = require('../services/qrcodeService');

/**
 * GET /bundle-analytics/:id
 * Bundle analytics dashboard (authenticated, owner or admin)
 */
async function getBundleAnalyticsPage(req, res) {
  const id = parseInt(req.params.id);
  const bundle = Bundle.findByIdWithItems(id);

  if (!bundle) {
    return res.redirect('/bundles');
  }
  if (bundle.creatorId !== req.user.id && !req.user.isAdmin) {
    return res.redirect('/bundles');
  }

  const analytics = BundleAnalytics.getSummary(id);
  const itemStats = BundleItemAnalytics.getClicksPerItem(id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.render('bundle-analytics', {
    user: req.user,
    bundle,
    analytics,
    itemStats,
    baseUrl,
    currentPage: 'bundles'
  });
}

/**
 * GET /api/bundle-analytics/:id
 * Bundle analytics data as JSON (authenticated, owner or admin)
 */
function getBundleAnalyticsData(req, res) {
  const id = parseInt(req.params.id);
  const bundle = Bundle.findById(id);

  if (!bundle) {
    return res.status(404).json({ error: 'Bundle not found' });
  }
  if (bundle.creatorId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const analytics = BundleAnalytics.getSummary(id);
  const itemStats = BundleItemAnalytics.getClicksPerItem(id);

  return res.json({ analytics, itemStats });
}

/**
 * GET /bt/:itemId
 * Per-item tracking redirect: records click then redirects to destination URL
 */
async function trackBundleItemClick(req, res) {
  const itemId = parseInt(req.params.itemId);
  const db = require('../config/database');

  const item = db.prepare('SELECT * FROM bundle_items WHERE id = ?').get(itemId);

  if (!item) {
    return res.status(404).render('error', {
      message: 'Link Not Found',
      error: { status: 404, stack: '' }
    });
  }

  // Record per-item click (fire-and-forget, non-blocking)
  try {
    const ip = AnalyticsService.getIpAddress(req);
    const ipHash = AnalyticsService.hashIp(ip);
    BundleItemAnalytics.record(item.id, item.bundleId, ipHash);
  } catch (e) {
    // Non-critical, don't block the redirect
  }

  return res.redirect(item.url);
}

/**
 * GET /qrcode/bundle/:id
 * Generate QR code image for a bundle
 */
async function getBundleQRCode(req, res) {
  const id = parseInt(req.params.id);
  const { theme = 'light' } = req.query;
  const bundle = Bundle.findById(id);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  const bundleUrl = `${req.protocol}://${req.get('host')}/b/${bundle.slug}`;
  try {
    const buffer = await QRCodeService.generateBuffer(bundleUrl, {
      color: theme === 'dark' ? { dark: '#34d399', light: '#0a0a0a' } : undefined
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
}

/**
 * GET /qrcode/bundle/:id/download
 * Download QR code for a bundle
 */
async function downloadBundleQRCode(req, res) {
  const id = parseInt(req.params.id);
  const { theme = 'light' } = req.query;
  const bundle = Bundle.findById(id);
  if (!bundle) return res.status(404).json({ error: 'Bundle not found' });

  const bundleUrl = `${req.protocol}://${req.get('host')}/b/${bundle.slug}`;
  try {
    const buffer = await QRCodeService.generateBuffer(bundleUrl, {
      color: theme === 'dark' ? { dark: '#34d399', light: '#0a0a0a' } : undefined,
      width: 1024
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qrcode-bundle-${bundle.slug}.png"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
}

module.exports = {
  getBundleAnalyticsPage,
  getBundleAnalyticsData,
  trackBundleItemClick,
  getBundleQRCode,
  downloadBundleQRCode
};
