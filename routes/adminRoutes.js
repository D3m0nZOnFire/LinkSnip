const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const AuditLogController = require('../controllers/auditLogController');
const AdminSettingsController = require('../controllers/adminSettingsController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { requireFeature } = require('../middleware/requireFeature');

const bundles = requireFeature('bundles');

// Instance settings (settings.json) and read-only roles (roles.json)
router.get('/admin/settings', isAuthenticated, isAdmin, AdminSettingsController.getSettingsPage);
router.put('/api/admin/settings', isAuthenticated, isAdmin, AdminSettingsController.updateSettings);

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

// API routes - URL Management
// Bulk routes must come before /:id routes to avoid matching "bulk-block" as an id
router.post('/api/admin/urls/bulk-block', isAuthenticated, isAdmin, AdminController.bulkBlockUrls);
router.post('/api/admin/urls/bulk-unblock', isAuthenticated, isAdmin, AdminController.bulkUnblockUrls);
router.post('/api/admin/urls/:id/block', isAuthenticated, isAdmin, AdminController.blockUrl);
router.post('/api/admin/urls/:id/unblock', isAuthenticated, isAdmin, AdminController.unblockUrl);

// API routes - Bundle Management
// Bulk routes must come before /:id routes
router.post('/api/admin/bundles/bulk-block', bundles, isAuthenticated, isAdmin, AdminController.bulkBlockBundles);
router.post('/api/admin/bundles/bulk-unblock', bundles, isAuthenticated, isAdmin, AdminController.bulkUnblockBundles);
router.post('/api/admin/bundles/:id/block', bundles, isAuthenticated, isAdmin, AdminController.blockBundle);
router.post('/api/admin/bundles/:id/unblock', bundles, isAuthenticated, isAdmin, AdminController.unblockBundle);

// API routes - Audit Logs
router.get('/api/admin/audit-logs/export', isAuthenticated, isAdmin, AuditLogController.exportAuditLogs);

// API routes - System Maintenance
router.post('/api/admin/maintenance/backup', isAuthenticated, isAdmin, AdminController.manualBackup);
router.post('/api/admin/maintenance/cleanup', isAuthenticated, isAdmin, AdminController.manualCleanup);

module.exports = router;