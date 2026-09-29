const express = require('express');
const router = express.Router();
const analyticsShareController = require('../controllers/analyticsShareController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { apiLimiter } = require('../middleware/rateLimiter');

const canShare = requirePermission('analyticsShareLinks');

// Public, read-only analytics for anyone holding the link
router.get('/stats/:token', apiLimiter, analyticsShareController.viewStats);

// Owner (or admin) manages the links of one URL
router.post('/api/urls/:id/share-links', canShare, isAuthenticated, analyticsShareController.createLink);
router.get('/api/urls/:id/share-links', isAuthenticated, analyticsShareController.listLinks);
router.delete('/api/share-links/:id', isAuthenticated, analyticsShareController.revokeLink);

// Admin → Analytics Shares
router.get('/admin/analytics-shares', isAuthenticated, isAdmin, analyticsShareController.getAdminPage);

module.exports = router;
