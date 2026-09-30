const express = require('express');
const router = express.Router();
const analyticsShareController = require('../controllers/analyticsShareController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { apiLimiter } = require('../middleware/rateLimiter');

const canShare = requirePermission('analyticsShareLinks');

// Public, read-only analytics for anyone holding the link
router.get('/stats/:token', apiLimiter, analyticsShareController.viewStats);

// Owner (or admin) manages the links of one item of any type
router.post('/api/share-links/:type/:id', canShare, isAuthenticated, analyticsShareController.createLink);
router.get('/api/share-links/:type/:id', isAuthenticated, analyticsShareController.listLinks);
router.delete('/api/share-links/:id', isAuthenticated, analyticsShareController.revokeLink);

// Old link-only address
router.all('/api/urls/:id/share-links', analyticsShareController.redirectOld);

// Admin → Analytics Shares
router.get('/admin/analytics-shares', isAuthenticated, isAdmin, analyticsShareController.getAdminPage);

module.exports = router;
