const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');
const { apiLimiter } = require('../middleware/rateLimiter');

const bundles = requireFeature('bundles');

// Public report submission (rate limited to prevent spam)
router.post('/api/report', apiLimiter, ReportController.submitReport);
router.post('/api/bundle-report', bundles, apiLimiter, ReportController.submitBundleReport);

// Admin routes - URL reports
router.get('/admin/reports', isAuthenticated, isAdmin, ReportController.getReportsPage);
router.post('/api/admin/moderation/:type/:id/block', isAuthenticated, isAdmin, ReportController.moderate('block'));
router.post('/api/admin/moderation/:type/:id/clear', isAuthenticated, isAdmin, ReportController.moderate('clear'));
router.put('/api/admin/reports/:id', isAuthenticated, isAdmin, ReportController.updateReportStatus);
router.delete('/api/admin/reports/:id', isAuthenticated, isAdmin, ReportController.deleteReport);
router.post('/api/admin/reports/:id/ban-user', isAuthenticated, isAdmin, ReportController.banUserFromReport);

// Admin routes - Bundle reports
router.put('/api/admin/bundle-reports/:id', bundles, isAuthenticated, isAdmin, ReportController.updateBundleReportStatus);
router.delete('/api/admin/bundle-reports/:id', bundles, isAuthenticated, isAdmin, ReportController.deleteBundleReport);

module.exports = router;
