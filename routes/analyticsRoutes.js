const express = require('express');
const router = express.Router();
const AnalyticsController = require('../controllers/analyticsController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');

const canViewAnalytics = requirePermission('analytics');

// Admin analytics routes (specific routes MUST come before parameterized routes)
router.get('/admin/analytics', isAdmin, AnalyticsController.getAdminAnalyticsPage);
router.get('/api/analytics/top', isAdmin, AnalyticsController.getTopUrls);

// One analytics page for every type (owner or admin; the type's feature switch is checked inside)
router.get('/analytics/:type/:id', isAuthenticated, canViewAnalytics, AnalyticsController.getAnalyticsPage);
router.get('/api/analytics/:type/:id', isAuthenticated, canViewAnalytics, AnalyticsController.getAnalyticsData);

// Old per-type addresses
router.get('/analytics/:id', AnalyticsController.redirectOld('url'));
router.get('/bundle-analytics/:id', AnalyticsController.redirectOld('bundle'));
router.get('/pastes/:id/analytics', AnalyticsController.redirectOld('paste'));
router.get('/api/analytics/:id', AnalyticsController.redirectOld('url', { api: true }));
router.get('/api/bundle-analytics/:id', AnalyticsController.redirectOld('bundle', { api: true }));

module.exports = router;
