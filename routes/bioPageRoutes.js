const express = require('express');
const router = express.Router();
const BioPageController = require('../controllers/bioPageController');
const { isAuthenticated } = require('../middleware/auth');
const requirePermission = require('../middleware/requirePermission');
const { apiLimiter } = require('../middleware/rateLimiter');

const canBioPage = requirePermission('bioPage');

// IMPORTANT: /bio/settings MUST come before /bio/:username to avoid "settings" being treated as a username

// Bio settings page (authenticated) - MUST be first
router.get('/bio/settings', isAuthenticated, canBioPage, BioPageController.getBioSettings);

// Public bio page (no auth required)
router.get('/bio/:username', BioPageController.getBioPage);

// API routes (authenticated + rate limited)
router.put('/api/bio', isAuthenticated, canBioPage, apiLimiter, BioPageController.updateBioPage);
router.post('/api/bio/urls/:urlId/toggle', isAuthenticated, canBioPage, apiLimiter, BioPageController.toggleUrlOnBioPage);
router.put('/api/bio/urls/:urlId/label', isAuthenticated, canBioPage, apiLimiter, BioPageController.setUrlLabel);
router.put('/api/bio/urls/reorder', isAuthenticated, canBioPage, apiLimiter, BioPageController.reorderBioPageUrls);

module.exports = router;
