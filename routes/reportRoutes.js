const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/reportController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// Public report submission for every type (rate limited; the type's feature switch is checked inside)
router.post('/api/reports', apiLimiter, ReportController.submit);

// Admin
router.get('/admin/reports', isAuthenticated, isAdmin, ReportController.getReportsPage);
router.post('/api/admin/moderation/:type/:id/block', isAuthenticated, isAdmin, ReportController.moderate('block'));
router.post('/api/admin/moderation/:type/:id/clear', isAuthenticated, isAdmin, ReportController.moderate('clear'));
router.put('/api/admin/reports/:id', isAuthenticated, isAdmin, ReportController.updateReport);
router.delete('/api/admin/reports/:id', isAuthenticated, isAdmin, ReportController.deleteReport);
router.post('/api/admin/reports/:id/ban-user', isAuthenticated, isAdmin, ReportController.banOwner);

module.exports = router;
