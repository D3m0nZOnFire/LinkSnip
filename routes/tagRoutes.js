const express = require('express');
const router = express.Router();
const TagController = require('../controllers/tagController');
const { isAuthenticated } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { requireFeature } = require('../middleware/requireFeature');

const canTag = requirePermission('tags');

// Tag management page
router.get('/tags', isAuthenticated, canTag, TagController.getTagManagementPage);

// Tag analytics page
router.get('/tags/:id/analytics', requireFeature('analytics'), isAuthenticated, canTag, TagController.getTagAnalytics);

// API endpoints
router.get('/api/tags', isAuthenticated, canTag, TagController.getAllTags);
router.get('/api/tags/:id/analytics', requireFeature('analytics'), isAuthenticated, canTag, TagController.getTagAnalyticsData);
router.put('/api/tags/:id', isAuthenticated, canTag, TagController.updateTag);
router.delete('/api/tags/:id', isAuthenticated, canTag, TagController.deleteTag);

module.exports = router;
