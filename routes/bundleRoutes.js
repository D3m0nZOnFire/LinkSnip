const express = require('express');
const router = express.Router();
const BundleController = require('../controllers/bundleController');
const BundleAnalyticsController = require('../controllers/bundleAnalyticsController');
const { isAuthenticated } = require('../middleware/auth');
const { createBundleLimiter, apiLimiter, unlockLimiter } = require('../middleware/rateLimiter');
const requirePermission = require('../middleware/requirePermission');
const { requireFeature } = require('../middleware/requireFeature');

const canViewAnalytics = requirePermission('analytics');
const qrCodes = requireFeature('qrCodes');

// Per-item tracking redirect (public, no auth)
router.get('/bt/:itemId', BundleAnalyticsController.trackBundleItemClick);

// Bundle QR codes (public)
router.get('/qrcode/bundle/:id/download', qrCodes, BundleAnalyticsController.downloadBundleQRCode);
router.get('/qrcode/bundle/:id', qrCodes, BundleAnalyticsController.getBundleQRCode);

// Bundle analytics dashboard
router.get('/bundle-analytics/:id', isAuthenticated, canViewAnalytics, BundleAnalyticsController.getBundleAnalyticsPage);
router.get('/api/bundle-analytics/:id', isAuthenticated, canViewAnalytics, apiLimiter, BundleAnalyticsController.getBundleAnalyticsData);

// Public bundle launcher
router.get('/b/:slug', BundleController.launchBundle);

// Password unlock for bundles
router.get('/unlock-bundle/:slug', BundleController.getUnlockBundlePage);
router.post('/unlock-bundle/:slug', unlockLimiter, BundleController.postUnlockBundle);

// Bundle API
router.post('/api/bundles', requirePermission('createBundles'), createBundleLimiter, BundleController.createBundle);
// Bulk delete must come before /:id to avoid routing conflict
router.post('/api/bundles/bulk-delete', apiLimiter, isAuthenticated, BundleController.bulkDeleteBundles);
router.get('/api/bundles/:id', apiLimiter, isAuthenticated, BundleController.getBundleById);
router.put('/api/bundles/:id', apiLimiter, isAuthenticated, BundleController.updateBundle);
router.delete('/api/bundles/:id', apiLimiter, isAuthenticated, BundleController.deleteBundle);

module.exports = router;
