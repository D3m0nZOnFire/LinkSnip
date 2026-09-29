const express = require('express');
const router = express.Router();
const UrlController = require('../controllers/urlController');
const { redirectLimiter, apiLimiter } = require('../middleware/rateLimiter');
const { isAuthenticated } = require('../middleware/auth');

// Public routes
router.get('/s/:slug', redirectLimiter, UrlController.redirect);

// API routes (protected)
// Bulk route must come before /:id to avoid matching "bulk-delete" as an id
router.post('/api/urls/bulk-delete', apiLimiter, isAuthenticated, UrlController.bulkDeleteUrls);
router.get('/api/urls/:id', apiLimiter, UrlController.getUrlById);
router.put('/api/urls/:id', apiLimiter, UrlController.updateUrl);
router.delete('/api/urls/:id', apiLimiter, UrlController.deleteUrl);

module.exports = router;