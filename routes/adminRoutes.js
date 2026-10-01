const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const AuditLogController = require('../controllers/auditLogController');
const AdminSettingsController = require('../controllers/adminSettingsController');
const BrandingController = require('../controllers/brandingController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Instance settings (settings.json) and roles (roles.json)
router.get('/admin/settings', isAuthenticated, isAdmin, AdminSettingsController.getSettingsPage);
router.get('/admin/settings/:tab', isAuthenticated, isAdmin, AdminSettingsController.getSettingsPage);
router.put('/api/admin/settings', isAuthenticated, isAdmin, AdminSettingsController.updateSettings);
router.put('/api/admin/roles', isAuthenticated, isAdmin, AdminSettingsController.updateRoles);
router.post('/api/admin/roles/:name/reset', isAuthenticated, isAdmin, AdminSettingsController.resetRole);

// Appearance: name, tagline, palettes (settings.json), logo and favicon (DATA_DIR/branding)
router.get('/admin/appearance', isAuthenticated, isAdmin, BrandingController.appearancePage);
router.put('/api/admin/appearance', isAuthenticated, isAdmin, BrandingController.updateAppearance);
router.post('/api/admin/branding/:asset', isAuthenticated, isAdmin, BrandingController.uploadAsset);
router.delete('/api/admin/branding/:asset', isAuthenticated, isAdmin, BrandingController.deleteAsset);
// Custom palettes (DATA_DIR/palettes); preview before :id
router.post('/api/admin/palettes/preview', isAuthenticated, isAdmin, BrandingController.previewPalette);
router.post('/api/admin/palettes', isAuthenticated, isAdmin, BrandingController.createPalette);
router.put('/api/admin/palettes/:id', isAuthenticated, isAdmin, BrandingController.updatePalette);
router.delete('/api/admin/palettes/:id', isAuthenticated, isAdmin, BrandingController.deletePalette);
router.delete('/api/admin/roles/:name', isAuthenticated, isAdmin, AdminSettingsController.deleteRole);

// Admin users page
router.get('/admin/users', isAuthenticated, isAdmin, AdminController.getUsersPage);

// Admin audit logs page
router.get('/admin/audit-logs', isAuthenticated, isAdmin, AuditLogController.getAuditLogsPage);

// API routes - Users
router.post('/api/admin/users', isAuthenticated, isAdmin, AdminController.createUser);
router.get('/api/admin/users/:id', isAuthenticated, isAdmin, AdminController.getUser);
router.put('/api/admin/users/:id', isAuthenticated, isAdmin, AdminController.updateUser);
router.delete('/api/admin/users/:id', isAuthenticated, isAdmin, AdminController.deleteUser);
router.post('/api/admin/users/:id/ban', isAuthenticated, isAdmin, AdminController.banUser);

// Block, unblock and delete for links, bundles, pastes and files: routes/adminItemRoutes.js

// API routes - Audit Logs
router.get('/api/admin/audit-logs/export', isAuthenticated, isAdmin, AuditLogController.exportAuditLogs);

// API routes - System Maintenance
router.post('/api/admin/maintenance/backup', isAuthenticated, isAdmin, AdminController.manualBackup);
router.post('/api/admin/maintenance/cleanup', isAuthenticated, isAdmin, AdminController.manualCleanup);

module.exports = router;