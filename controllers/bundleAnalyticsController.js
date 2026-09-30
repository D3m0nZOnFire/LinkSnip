const Bundle = require('../models/Bundle');
const AnalyticsService = require('../services/analyticsService');
const QRCodeService = require('../services/qrcodeService');
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
  trackBundleItemClick,
  getBundleQRCode,
  downloadBundleQRCode
};
