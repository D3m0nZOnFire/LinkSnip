const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const User = require('../models/User');

// Settings page
router.get('/settings', isAuthenticated, UserController.getSettings);

// Username lookup (used by file sharing UI)
router.get('/api/users/lookup', isAuthenticated, (req, res) => {
  const username = (req.query.username || '').trim().toLowerCase();
  if (!username || username.length < 2) {
    return res.json({ found: false });
  }
  const user = User.findByUsername(username);
  if (!user || user.id === req.user.id) {
    return res.json({ found: false });
  }
  return res.json({ found: true, id: user.id, username: user.username });
});

// API routes
// They check the current password: wrong guesses count like failed logins (authLimiter, failures only)
router.put('/api/user/username', isAuthenticated, authLimiter, UserController.updateUsername);
router.put('/api/user/password', isAuthenticated, authLimiter, UserController.updatePassword);
router.delete('/api/user/account', isAuthenticated, authLimiter, UserController.deleteAccount);

module.exports = router;