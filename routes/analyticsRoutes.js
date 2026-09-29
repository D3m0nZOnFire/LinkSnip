const express = require('express');
const router = express.Router();
const AnalyticsController = require('../controllers/analyticsController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');

const canViewAnalytics = requirePermission('analytics');

// Admin analytics routes (specific routes MUST come before parameterized routes)
router.get('/admin/analytics', isAdmin, AnalyticsController.getAdminAnalyticsPage);
router.get('/api/analytics/top', isAdmin, AnalyticsController.getTopUrls);

// User analytics routes (authenticated users)
router.get('/analytics/:id', isAuthenticated, canViewAnalytics, AnalyticsController.getAnalyticsPage);
router.get('/api/analytics/:id', isAuthenticated, canViewAnalytics, AnalyticsController.getAnalyticsData);

module.exports = router;
