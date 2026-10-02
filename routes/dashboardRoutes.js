const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboardController');
const AdminOverviewController = require('../controllers/adminOverviewController');
const AdminItemsController = require('../controllers/adminItemsController');
const AdminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// User dashboard
router.get('/dashboard', isAuthenticated, DashboardController.getUserDashboard);
router.get('/api/dashboard/urls', isAuthenticated, DashboardController.getUserUrlsApi);

// Admin dashboard
router.get('/admin', isAuthenticated, isAdmin, AdminOverviewController.overviewPage);
// Admin → Items: every type in one list; the old per-type lists redirect there
router.get('/admin/items', isAuthenticated, isAdmin, AdminItemsController.itemsPage);
router.get('/admin/links', isAuthenticated, isAdmin, AdminItemsController.redirectTo('url'));
router.get('/api/admin/urls', isAuthenticated, isAdmin, DashboardController.getAllUrlsApi);

module.exports = router;