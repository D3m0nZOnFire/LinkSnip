const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { apiLimiter, createPasteLimiter } = require('../middleware/rateLimiter');
const requirePermission = require('../middleware/requirePermission');
const { requireFeature } = require('../middleware/requireFeature');
const PasteController = require('../controllers/pasteController');

const canViewAnalytics = requirePermission('analytics');
const qrCodes = requireFeature('qrCodes');

// ── API — create is anonymous-allowed (limiter only, no auth), like /api/bundles
router.post('/api/pastes', requirePermission('createPastes'), createPasteLimiter, PasteController.create);
router.post('/api/pastes/bulk-delete', apiLimiter, isAuthenticated, PasteController.bulkDelete); // before /:id
router.get('/api/pastes', isAuthenticated, PasteController.list);
router.get('/api/pastes/:id', apiLimiter, isAuthenticated, PasteController.getById);
router.patch('/api/pastes/:id', apiLimiter, isAuthenticated, PasteController.updateSettings);
router.delete('/api/pastes/:id', apiLimiter, isAuthenticated, PasteController.delete);

// ── Full-page editor (owner/admin)
router.get('/pastes/:id/edit', isAuthenticated, PasteController.showEditPage);

// ── Full-page analytics (owner/admin)
router.get('/pastes/:id/analytics', isAuthenticated, canViewAnalytics, PasteController.showAnalyticsPage);

// ── Admin
router.get('/admin/pastes', isAuthenticated, isAdmin, PasteController.adminList);
router.delete('/api/admin/pastes/:id', isAuthenticated, isAdmin, PasteController.adminDelete);
router.post('/api/admin/pastes/:id/block', isAuthenticated, isAdmin, PasteController.blockPaste);
router.post('/api/admin/pastes/:id/unblock', isAuthenticated, isAdmin, PasteController.unblockPaste);

// ── QR (public)
router.get('/qrcode/paste/:slug/download', qrCodes, PasteController.qrDownload); // before /qrcode/paste/:slug
router.get('/qrcode/paste/:slug', qrCodes, PasteController.qr);
router.get('/api/qrcode/paste/:slug/dataurl', qrCodes, PasteController.qrDataUrl);


// ── Public info/preview page (mirrors /info/:slug for short links)
router.get('/p-info/:slug', PasteController.showInfoPage);

// ── Public — raw BEFORE :slug
router.get('/p/:slug/raw', PasteController.raw);
router.get('/p/:slug', PasteController.view);

module.exports = router;
