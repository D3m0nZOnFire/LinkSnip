const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboardController');
const AdminOverviewController = require('../controllers/adminOverviewController');
const AdminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// User dashboard
router.get('/dashboard', isAuthenticated, DashboardController.getUserDashboard);
router.get('/api/dashboard/urls', isAuthenticated, DashboardController.getUserUrlsApi);

// Admin dashboard
router.get('/admin', isAuthenticated, isAdmin, AdminOverviewController.overviewPage);
router.get('/admin/links', isAuthenticated, isAdmin, DashboardController.getAdminDashboard);
router.get('/api/admin/urls', isAuthenticated, isAdmin, DashboardController.getAllUrlsApi);

module.exports = router;