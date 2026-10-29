const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Settings page
router.get('/settings', isAuthenticated, UserController.getSettings);

// API routes
// They check the current password: wrong guesses count like failed logins (authLimiter, failures only)
router.put('/api/user/username', isAuthenticated, authLimiter, UserController.updateUsername);
router.put('/api/user/password', isAuthenticated, authLimiter, UserController.updatePassword);
router.delete('/api/user/account', isAuthenticated, authLimiter, UserController.deleteAccount);

module.exports = router;